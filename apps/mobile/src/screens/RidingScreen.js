import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { isScreenTripActive } from '../state/trip-transition';
import { useRealtime } from '../realtime/RealtimeProvider';
import { connectBell, disconnect, getBellDeviceName, startBeaconScan, stopBeaconScan } from '../ble/bleManager';
import { canStartBeaconScan } from '../ble/beacon-scan-gate';
import { startBeaconScanWithRetry, stopBeaconScanWithRetry } from '../ble/beacon-scan-controller';
import { connectBellWithRetry, disconnectBellWithRetry } from '../ble/bell-connect-controller';

const INITIAL_STATUS = {
  currentStation: null,
  nextStation: null,
  remainingStations: null,
  tripStatus: 'WAITING_BUS',
  boardingMethod: null,
  boardingConfirmedAt: null,
  shouldTriggerBell: false,
  bellStatus: 'NOT_REQUESTED',
  bellRequestId: null,
  command: null,
  guideMessage: '버스 위치를 확인하는 중입니다.',
  shouldScanBeacon: false,
  arrivalPollIntervalSeconds: null,
};

export default function RidingScreen({ route, navigation }) {
  const { tripId, selectedRoute } = route.params;
  const [status, setStatus] = useState(INITIAL_STATUS);
  const bellHandledRef = useRef(false);
  const requestCounterRef = useRef(0);
  const stoppedRef = useRef(false);
  const locationSubscriptionRef = useRef(null);
  const stoppingBeaconScanRef = useRef(false);
  const startingBeaconScanRef = useRef(false);
  const connectingBellRef = useRef(false);
  const patchInFlightRef = useRef(false);
  const arrivalPollFailureCountRef = useRef(0);

  // 실차 GPS 계측용
  const locationWatchStartedAtRef = useRef(null);
  const firstLocationFixReceivedRef = useRef(false);
  const locationPatchSkippedCountRef = useRef(0);

  const { state, dispatch } = useTrip();
  const { session, isConnected } = useRealtime();
  const currentTripStatus = state.tripStatus ?? status.tripStatus;
  const boardingConfirmedAt =
    state.boardingConfirmedAt ?? status.boardingConfirmedAt;

  // GPS 추적을 논리적으로만 멈추지 않고,
  // 네이티브 watch subscription까지 실제로 해제한다.
  const stopLocationWatch = () => {
    stoppedRef.current = true;

    if (locationSubscriptionRef.current) {
      try {
        locationSubscriptionRef.current.remove();
      } catch (error) {
        console.log('[GPS] watch 구독 해제 실패:', error);
      } finally {
        locationSubscriptionRef.current = null;
      }
    }
  };

  // 비콘 스캔 재시도는 effect 가 끝난 뒤에도 이어진다. 그 사이 탑승이 확정되거나
  // 운행이 바뀌어도 콜백이 렌더 당시의 값을 계속 보면 안 되므로 ref 로 최신 값을
  // 들고 있는다.
  const activeTripIdRef = useRef(state.tripId);
  activeTripIdRef.current = state.tripId;
  const boardingConfirmedAtRef = useRef(boardingConfirmedAt);
  boardingConfirmedAtRef.current = boardingConfirmedAt;

  const waitBeforeRetry = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 스캔 중지는 경로가 넷이다(늦은 성공 되돌리기, 탑승 확정, 취소, 운행 종료).
  // 넷 다 첫 실패에서 멈추면 실제 장치는 켜진 채 남는다. 하나로 모아 제한 재시도한다.
  //
  // 실패했을 때 beaconScanActive 를 끄지 않는 것이 핵심이다. 실제로는 켜져 있을 수
  // 있으므로 켜진 것으로 남겨 두어야 뒤이은 종료 경로가 다시 끈다.
  const runStopBeaconScan = (label) =>
    stopBeaconScanWithRetry({
      stopBeaconScan,
      onStopped: () => {
        dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: false });
      },
      onGaveUp: (error) => {
        console.log(label, error);
      },
      wait: waitBeforeRetry,
    });

  // 예모님 재지적(2026-08-28, P1): 취소된 이전 운행에서 stoppedRef.current = true가
  // 남아있으면, 같은 Riding 화면 인스턴스가 재사용될 때(A 취소 후 B 선택) 새 tripId로도
  // GPS 추적이 계속 멈춰있는 상태가 된다. tripId가 바뀔 때마다 정지 관련 ref들을
  // 새 운행 기준으로 초기화한다.
  useEffect(() => {
    stoppedRef.current = false;
    bellHandledRef.current = false;
    arrivalPollFailureCountRef.current = 0;
    locationWatchStartedAtRef.current = null;
    firstLocationFixReceivedRef.current = false;
    locationPatchSkippedCountRef.current = 0;
  }, [tripId]);

  const screenTitle = (() => {
    switch (currentTripStatus) {
      case 'WAITING_BUS':
        return '버스 탑승 대기';
      case 'NEAR_DESTINATION':
        return '하차 준비';
      case 'TRIP_DONE':
        return '목적지 도착';
      case 'ON_BUS':
        return '버스 탑승 중';
      default:
        return '운행 상태 확인 중';
    }
  })();

  // 최초 진입 안내
  useFocusEffect(
    React.useCallback(() => {
      if (isConnected) return;

      const timer = setTimeout(() => {
        Speech.speak('버스 위치를 확인하는 중입니다.', {
          language: 'ko',
        });
      }, 500);

      return () => {
        clearTimeout(timer);
        Speech.stop();
      };
    }, [isConnected]),
  );

  // 정류장·상태 바뀔 때마다 TTS
  useEffect(() => {
    if (isConnected) return;

    if (status.guideMessage && status.remainingStations !== 1) {
      const timer = setTimeout(() => {
        Speech.speak(status.guideMessage, { language: 'ko' });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [status.guideMessage, status.remainingStations, isConnected]);

  // 효린님 확인(2026-08-28): shouldScanBeacon이 true이고 아직 스캔 중이 아니면 자동으로
  // startBeaconScan()을 호출한다. 스캔을 시작하는 곳은 앱 전체에서 여기 하나다.
  //
  // 예모님 지적(2026-09-04, PR #47 P1): 서버 신호가 지팡이 준비보다 먼저 도착할 수
  // 있다. 그때 startBeaconScan()은 BLE_NOT_CONNECTED로 실패하는데, 실패해도
  // beaconScanActive는 false 그대로이고 shouldScanBeacon도 계속 true라서 이 effect의
  // 의존값이 바뀌지 않는다. 그러면 다시 시도되지 않고 스캔이 영영 안 켜진다.
  // 그래서 caneReady를 조건과 의존값에 함께 넣는다. 신호가 먼저 와도 준비가 끝나는
  // 순간 값이 바뀌면서 그때 시작된다.
  useEffect(() => {
    if (
      canStartBeaconScan({
        shouldScanBeacon: status.shouldScanBeacon,
        caneReady: state.caneReady,
        beaconScanActive: state.beaconScanActive,
        starting: startingBeaconScanRef.current,
      })
    ) {
      startingBeaconScanRef.current = true;
      const attemptTripId = tripId;

      // 이 운행에서 아직 스캔이 필요한지. 재시도를 기다리는 동안, 또는 명령이
      // 오가는 동안 탑승·취소가 끼어들 수 있다. 그때 늦게 성공한 요청이 스캔을
      // 켜면 탑승한 뒤에도 지팡이가 계속 진동한다.
      //
      // 판단은 렌더 당시 값이 아니라 ref 로 최신 값을 본다. 재시도는 effect 가
      // 끝난 뒤에도 이어지므로 닫힌 값을 쓰면 탑승 확정을 놓친다.
      const isStillWanted = () =>
        !stoppedRef.current &&
        isScreenTripActive(activeTripIdRef.current, attemptTripId) &&
        !boardingConfirmedAtRef.current;

      startBeaconScanWithRetry({
        startBeaconScan,
        isStillWanted,
        onStarted: () => {
          dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: true });
        },
        onStartedTooLate: () =>
          // 이미 끝난 대기 구간이다. 켜진 스캔을 되돌리고 완료를 기다린다.
          stopBeaconScanWithRetry({
            stopBeaconScan,
            onStopped: () => undefined,
            onGaveUp: (error) => {
              console.log('늦게 성공한 스캔을 되돌리지 못함:', error);
              // 앱은 이 스캔을 켜졌다고 기록한 적이 없다. 여기서 끝내면 실제 장치는
              // 켜져 있는데 상태는 꺼짐이라, 탑승·취소 종료 경로도 다시 끄지 않는다.
              // 켜진 것으로 남겨 그 경로들이 이어서 끄게 한다.
              dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: true });
            },
            wait: waitBeforeRetry,
          }),
        onGaveUp: (error) => {
          console.log('비콘 스캔 시작을 상한까지 재시도했지만 실패:', error);
          Speech.speak(
            '지팡이 진동 안내를 시작하지 못했습니다. 정류장에 계신 주변 분께 버스가 오면 알려 달라고 요청해 주세요.',
            { language: 'ko' },
          );
        },
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }).finally(() => {
        startingBeaconScanRef.current = false;
      });
    }
  }, [status.shouldScanBeacon, state.caneReady, state.beaconScanActive]);

  // 정민님 확인(2026-08-12): 탑승 완료 시 비콘 스캔 중지
  useEffect(() => {
    if (
      boardingConfirmedAt &&
      state.beaconScanActive &&
      !stoppingBeaconScanRef.current
    ) {
      stoppingBeaconScanRef.current = true;

      runStopBeaconScan('탑승 확정 후 비콘 스캔 중지를 상한까지 재시도했지만 실패:')
        .finally(() => {
          stoppingBeaconScanRef.current = false;
        });
    }
  }, [boardingConfirmedAt, state.beaconScanActive]);

  // 탑승이 확정되면 하차벨 보드를 연결한다.
  //
  // 예전에는 운행을 만들 때 지팡이와 함께 한 번에 연결했는데, 그 시점의 하차벨 보드는
  // 아직 오지 않은 버스 안이라 BLE 범위 밖이었다. 반드시 실패했고 다시 찾지 않았다.
  // 2026-09-04 실차에서 두 번 다 여기서 막혀, 하차 화면이 연결 없음을 보고 1초 만에
  // 실패 처리했다. 지금은 버스 안에 있는 것이 확실한 이 시점에 연결한다.
  //
  // 연결할 보드 이름은 서버가 노선별로 내려준 targetBeaconId 를 쓴다. 노선을 바꾸면
  // 보드도 바뀌기 때문에, 앱에 이름을 박아 두면 이번처럼 DB 만 바뀌었을 때 어긋난다.
  useEffect(() => {
    if (
      !boardingConfirmedAt ||
      state.bellConnected !== null ||
      connectingBellRef.current
    ) {
      return;
    }

    connectingBellRef.current = true;
    const attemptTripId = tripId;
    const targetBeaconId = state.targetBeaconId;

    // 재시도를 기다리는 동안 운행이 끝나거나 바뀔 수 있다. 렌더 당시 값이 아니라
    // ref 로 최신 값을 본다.
    const isStillWanted = () =>
      !stoppedRef.current &&
      isScreenTripActive(activeTripIdRef.current, attemptTripId);

    connectBellWithRetry({
      connectBell: () => connectBell(targetBeaconId),
      isStillWanted,
      onConnected: () => {
        dispatch({ type: 'SET_BELL_CONNECTED', connected: true });
      },
      onConnectedTooLate: () =>
        // 끝난 운행에 늦게 붙었다. 다음 운행에 남지 않도록 끊는다. 한 번 실패하고
        // 끝내면 이전 버스의 연결이 다음 운행까지 남는다.
        disconnectBellWithRetry({
          disconnectBell: () => disconnect(getBellDeviceName()),
          onGaveUp: (error) => {
            console.log('늦게 성공한 하차벨 연결을 상한까지 끊지 못함:', error);
          },
          wait: waitBeforeRetry,
        }),
      onGaveUp: () => {
        dispatch({ type: 'SET_BELL_CONNECTED', connected: false });
        // 조용히 넘어가면 사용자는 내릴 때가 되어서야 벨이 안 눌린다는 것을 안다.
        Speech.speak(
          '하차벨에 연결하지 못했습니다. 내리기 전에 기사님께 직접 말씀해 주세요.',
          { language: 'ko' },
        );
      },
      wait: waitBeforeRetry,
    }).finally(() => {
      connectingBellRef.current = false;
    });
  }, [boardingConfirmedAt, state.bellConnected, state.targetBeaconId]);

  // 예모님 지적(2026-08-27, P1) + 유나님 지적(2026-08-28):
  // 취소 감지 시 GPS/BLE를 즉시 중지한다.
  // RESET_TRIP_KEEP_SEARCH·RESET_TRIP 모두 이제 beaconScanActive를 건드리지 않고 이전 값을
  // 그대로 보존하므로(TripContext.js 참고), 여기서 실제로 stopBeaconScan()을 호출해서
  // "성공"을 확인한 뒤에만 SET_BEACON_SCAN_ACTIVE(active: false)를 dispatch한다.
  const isThisTripStillActive = isScreenTripActive(state.tripId, tripId);

  useEffect(() => {
    if (!isThisTripStillActive) {
      stopLocationWatch();

      if (
        state.beaconScanActive &&
        !stoppingBeaconScanRef.current
      ) {
        stoppingBeaconScanRef.current = true;

        runStopBeaconScan('취소 후 비콘 스캔 중지를 상한까지 재시도했지만 실패:')
          .finally(() => {
            stoppingBeaconScanRef.current = false;
          });
      }
    }
  }, [isThisTripStillActive, state.beaconScanActive]);

  // 1정거장 남았을 때 TTS 출력 후 하차 안내 화면 전환
  useEffect(() => {
    if (
      status.shouldTriggerBell === true &&
      status.bellStatus === 'PENDING' &&
      status.remainingStations === 1 &&
      status.bellRequestId &&
      status.command === 'STOP_REQUEST' &&
      !bellHandledRef.current
    ) {
      if (isConnected) {
        handleAlightNavigation();
        return;
      }

      const timer = setTimeout(() => {
        Speech.speak(status.guideMessage, {
          language: 'ko',
          onDone: () => {
            handleAlightNavigation();
          },
        });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [status, isConnected]);

  // 실제 GPS 위치를 연속 구독한다.
  // 기존 2초 polling + getCurrentPositionAsync 대신 watchPositionAsync를 사용한다.
  useEffect(() => {
    let cancelled = false;

    locationWatchStartedAtRef.current = Date.now();
    firstLocationFixReceivedRef.current = false;
    locationPatchSkippedCountRef.current = 0;

    console.log('[GPS] watch 구독 시작', {
      tripId,
      startedAt: new Date(
        locationWatchStartedAtRef.current,
      ).toISOString(),
    });

    (async () => {
      const permission =
        await Location.requestForegroundPermissionsAsync();

      console.log('[GPS] 위치 권한 상태', {
        status: permission.status,
        canAskAgain: permission.canAskAgain,
        granted: permission.granted,
        expires: permission.expires,
        androidAccuracy:
          permission.android?.accuracy ?? 'unknown',
      });

      if (cancelled || stoppedRef.current) {
        return;
      }

      if (permission.status !== 'granted') {
        stopLocationWatch();

        Speech.speak(
          '위치 권한이 없어 운행 추적을 시작할 수 없습니다.',
          { language: 'ko' },
        );

        navigation.navigate('Error');
        return;
      }

      const subscription =
        await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 2000,
            distanceInterval: 0,
          },
          async (location) => {
            if (cancelled || stoppedRef.current) {
              return;
            }

            const callbackReceivedAt = Date.now();
            const locationTimestamp = Number(
              location.timestamp,
            );

            // 실제 위치 측정 시각을 알 수 없는 fix는
            // 현재 시각을 대신 붙여 정상 위치처럼 서버로 보내지 않는다.
            if (!Number.isFinite(locationTimestamp)) {
              console.warn(
                '[GPS] location.timestamp 없음 - PATCH하지 않음',
                {
                  callbackReceivedAt: new Date(
                    callbackReceivedAt,
                  ).toISOString(),
                  accuracy: location.coords.accuracy,
                  latitude: location.coords.latitude,
                  longitude: location.coords.longitude,
                },
              );

              return;
            }

            const locationAgeMs = Math.max(
              0,
              callbackReceivedAt - locationTimestamp,
            );

            if (!firstLocationFixReceivedRef.current) {
              firstLocationFixReceivedRef.current = true;

              console.log('[GPS] 첫 fix 수신', {
                receivedAt: new Date(
                  callbackReceivedAt,
                ).toISOString(),
                watchToFirstFixMs:
                  locationWatchStartedAtRef.current == null
                    ? null
                    : callbackReceivedAt -
                      locationWatchStartedAtRef.current,
                locationTimestamp: new Date(
                  locationTimestamp,
                ).toISOString(),
                locationAgeMs,
                accuracy: location.coords.accuracy,
              });
            }

            console.log('[GPS] fix 수신', {
              callbackReceivedAt: new Date(
                callbackReceivedAt,
              ).toISOString(),
              locationTimestamp: new Date(
                locationTimestamp,
              ).toISOString(),
              locationAgeMs,
              accuracy: location.coords.accuracy,
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            });

            // stale 임계값은 실차 로그 확인 후 확정한다.
            // 기준 확정 전에는 임의의 시간값으로 위치를 버리지 않는다.

            if (patchInFlightRef.current) {
              locationPatchSkippedCountRef.current += 1;

              console.log(
                '[GPS] PATCH in-flight로 fix 건너뜀',
                {
                  skippedCount:
                    locationPatchSkippedCountRef.current,
                  callbackReceivedAt: new Date(
                    callbackReceivedAt,
                  ).toISOString(),
                  locationAgeMs,
                },
              );

              return;
            }

            await patchStatus(
              location,
              callbackReceivedAt,
            );
          },
        );

      // watchPositionAsync가 resolve되기 전에 화면이 종료되거나
      // 운행이 중단된 경우, 뒤늦게 생성된 subscription을 즉시 해제한다.
      if (cancelled || stoppedRef.current) {
        subscription.remove();

        console.log(
          '[GPS] 늦게 생성된 watch 구독 즉시 해제',
          {
            tripId,
            endedAt: new Date().toISOString(),
          },
        );

        return;
      }

      // 기존 subscription이 남아 있다면 중복 watch가 생기지 않도록 제거한다.
      if (locationSubscriptionRef.current) {
        try {
          locationSubscriptionRef.current.remove();
        } catch (error) {
          console.log(
            '[GPS] 기존 watch 구독 해제 실패:',
            error,
          );
        }
      }

      locationSubscriptionRef.current =
        subscription;
    })().catch((error) => {
      console.log('[GPS] watch 시작 실패:', error);

      if (!cancelled && !stoppedRef.current) {
        stopLocationWatch();
        navigation.navigate('Error');
      }
    });

    return () => {
      cancelled = true;
      stopLocationWatch();

      console.log('[GPS] watch 구독 종료', {
        tripId,
        endedAt: new Date().toISOString(),
        skippedCount:
          locationPatchSkippedCountRef.current,
      });
    };
  }, [tripId]);

  // 효린님 확인(2026-08-28): WAITING_BUS 동안 서버가 알려준 주기로 GET /status를 반복
  // 호출해 도착정보를 갱신한다. 실패가 누적되면(20초 이상) 오류 화면으로 전환한다.
  useEffect(() => {
    if (currentTripStatus !== 'WAITING_BUS') {
      arrivalPollFailureCountRef.current = 0;
      return;
    }

    const intervalSeconds =
      status.arrivalPollIntervalSeconds ?? 15;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || stoppedRef.current) {
        return;
      }

      try {
        const latest =
          await apiClient.trips.getStatus(tripId);

        if (
          cancelled ||
          stoppedRef.current ||
          state.tripId !== tripId
        ) {
          return;
        }

        arrivalPollFailureCountRef.current = 0;

        setStatus((prev) => ({
          ...prev,
          ...latest,
        }));

        dispatch({
          type: 'UPDATE_TRIP_STATUS',
          status: latest,
        });
      } catch (error) {
        arrivalPollFailureCountRef.current += 1;

        if (
          arrivalPollFailureCountRef.current *
            intervalSeconds >=
          20
        ) {
          stopLocationWatch();
          navigation.navigate('Error');
        }
      }
    };

    const interval = setInterval(
      poll,
      intervalSeconds * 1000,
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    currentTripStatus,
    status.arrivalPollIntervalSeconds,
    tripId,
  ]);

  // PATCH /api/trips/{tripId}/status 호출
  const patchStatus = async (
    location,
    callbackReceivedAt = Date.now(),
  ) => {
    patchInFlightRef.current = true;

    const patchStartedAt = Date.now();
    const locationTimestamp = Number(
      location.timestamp,
    );

    const locationAgeMs = Number.isFinite(
      locationTimestamp,
    )
      ? Math.max(
          0,
          callbackReceivedAt - locationTimestamp,
        )
      : null;

    requestCounterRef.current += 1;

    const requestId =
      `location-${tripId}-${requestCounterRef.current}`;

    try {
      // watch callback에서도 검사하지만, 다른 호출 경로가 생겨도
      // 잘못된 recordedAt을 만들지 않도록 여기서도 방어한다.
      if (!Number.isFinite(locationTimestamp)) {
        console.warn(
          '[GPS] PATCH 중단 - location.timestamp 없음',
          {
            requestId,
            callbackReceivedAt: new Date(
              callbackReceivedAt,
            ).toISOString(),
            accuracy: location.coords.accuracy,
          },
        );

        return;
      }

      console.log('[GPS] PATCH 시작', {
        requestId,
        startedAt: new Date(
          patchStartedAt,
        ).toISOString(),
        callbackReceivedAt: new Date(
          callbackReceivedAt,
        ).toISOString(),
        locationTimestamp: new Date(
          locationTimestamp,
        ).toISOString(),
        locationAgeMs,
        accuracy: location.coords.accuracy,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const data =
        await apiClient.trips.updateStatus(
          tripId,
          {
            requestId,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            recordedAt: new Date(
              locationTimestamp,
            ).toISOString(),
            source: 'GPS',
          },
        );

      console.log('[GPS] PATCH 완료', {
        requestId,
        completedAt: new Date().toISOString(),
        durationMs:
          Date.now() - patchStartedAt,
        skippedWhileInFlight:
          locationPatchSkippedCountRef.current,
      });

      if (
        stoppedRef.current ||
        state.tripId !== tripId
      ) {
        return;
      }

      setStatus(data);

      dispatch({
        type: 'UPDATE_TRIP_STATUS',
        status: data,
      });

      session?.notifyStatusChange({
        tripStatus: data.tripStatus,
        boardingMethod: data.boardingMethod,
        boardingConfirmedAt:
          data.boardingConfirmedAt,
        remainingStations:
          data.remainingStations,
        currentStation: data.currentStation,
        bellStatus: data.bellStatus,
        guideMessage: data.guideMessage,
      });

      // 예모님 재지적(2026-08-28, P1): TRIP_DONE·TRIP_NOT_FOUND에서도
      // RESET_TRIP_KEEP_SEARCH와 같은 이유로 실제 stopBeaconScan()이
      // 성공한 뒤에만 상태를 끄도록 순서를 지킨다.
      if (data.tripStatus === 'TRIP_DONE') {
        stopLocationWatch();
        await stopBeaconScanIfActive();

        dispatch({
          type: 'RESET_TRIP',
        });
      } else if (
        data.tripStatus === 'CANCELLED'
      ) {
        stopLocationWatch();

        dispatch({
          type: 'RESET_TRIP_KEEP_SEARCH',
        });
      }
    } catch (error) {
      console.log('[GPS] PATCH 실패', {
        requestId,
        failedAt: new Date().toISOString(),
        durationMs:
          Date.now() - patchStartedAt,
        locationAgeMs,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      if (
        stoppedRef.current ||
        state.tripId !== tripId
      ) {
        return;
      }

      if (error instanceof ApiError) {
        if (
          error.errorCode ===
          'INVALID_TRIP_STATUS'
        ) {
          stopLocationWatch();

          try {
            const latest =
              await apiClient.trips.getStatus(
                tripId,
              );

            setStatus(latest);

            dispatch({
              type: 'UPDATE_TRIP_STATUS',
              status: latest,
            });

            session?.notifyStatusChange({
              tripStatus: latest.tripStatus,
              boardingMethod:
                latest.boardingMethod,
              boardingConfirmedAt:
                latest.boardingConfirmedAt,
              remainingStations:
                latest.remainingStations,
              currentStation:
                latest.currentStation,
              bellStatus: latest.bellStatus,
              guideMessage:
                latest.guideMessage,
            });
          } catch {
            // 최신 상태 조회도 실패하면 오류 화면으로
          }

          return;
        }

        if (
          error.errorCode ===
          'TRIP_NOT_FOUND'
        ) {
          stopLocationWatch();
          await stopBeaconScanIfActive();

          dispatch({
            type: 'RESET_TRIP',
          });

          navigation.navigate('Error');
          return;
        }
      }

      console.log(
        '위치 업데이트 실패:',
        error,
      );
    } finally {
      patchInFlightRef.current = false;
    }
  };

  // 예모님 재지적(2026-08-28, P1): TRIP_DONE·TRIP_NOT_FOUND에서
  // RESET_TRIP을 dispatch하기 전에 실제 스캔이 켜져 있으면
  // stopBeaconScan()을 먼저 호출해서 성공을 기다린다.
  // 실패해도 RESET_TRIP은 진행하되(운행 자체는 끝난 상태),
  // 다음 취소 감지 useEffect가 beaconScanActive가 남아있으면
  // 다시 시도할 수 있도록 상태는 여기서 강제로 끄지 않는다.
  const stopBeaconScanIfActive = async () => {
    if (
      !state.beaconScanActive ||
      stoppingBeaconScanRef.current
    ) {
      return;
    }

    stoppingBeaconScanRef.current = true;

    try {
      await runStopBeaconScan(
        '종료 시 비콘 스캔 중지를 상한까지 재시도했지만 실패, 취소 감지 로직이 다시 시도함:',
      );
    } finally {
      stoppingBeaconScanRef.current = false;
    }
  };

  const handleAlightNavigation = () => {
    if (bellHandledRef.current) {
      return;
    }

    bellHandledRef.current = true;
    stopLocationWatch();
    Speech.stop();

    navigation.navigate('Alight', {
      tripId,
      bellRequestId: status.bellRequestId,
      command: status.command,
      guideMessage: status.guideMessage,
    });
  };

  const isBoarded = Boolean(
    status.boardingConfirmedAt,
  );

  if (
    !isBoarded ||
    !status.currentStation ||
    !status.nextStation
  ) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>
          {screenTitle}
        </Text>

        <Text style={styles.subtitle}>
          지정한 목적지까지 안전하게 안내합니다.
        </Text>

        <View style={styles.guideBox}>
          <Text style={styles.guideIcon}>
            🔊
          </Text>

          <Text style={styles.guideText}>
            {status.guideMessage}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {screenTitle}
      </Text>

      <Text style={styles.subtitle}>
        지정한 목적지까지 안전하게 안내합니다.
      </Text>

      <View style={styles.infoBox}>
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>
            📍
          </Text>

          <Text style={styles.label}>
            현재 정류장
          </Text>
        </View>

        <Text style={styles.stationName}>
          {status.currentStation.stationName}
        </Text>
      </View>

      <View
        style={[
          styles.infoBox,
          styles.infoBoxHighlight,
        ]}
      >
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>
            ➡️
          </Text>

          <Text
            style={[
              styles.label,
              styles.labelOnHighlight,
            ]}
          >
            다음 정류장
          </Text>
        </View>

        <Text style={styles.stationName}>
          {status.nextStation.stationName}
        </Text>
      </View>

      <View style={styles.remainBox}>
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>
            ℹ️
          </Text>

          <Text style={styles.remainText}>
            남은 정류장
          </Text>
        </View>

        <Text style={styles.remainCount}>
          {status.remainingStations}
        </Text>
      </View>

      <View style={styles.guideBox}>
        <Text style={styles.guideIcon}>
          🔊
        </Text>

        <Text style={styles.guideText}>
          {status.guideMessage}
        </Text>
      </View>

      {status.remainingStations === 2 && (
        <View style={styles.prepareBox}>
          <Text style={styles.prepareText}>
            ⚠️ 곧 하차 준비하세요
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0C10',
    padding: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFD400',
    textAlign: 'left',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
    marginBottom: 20,
  },
  infoBox: {
    backgroundColor: '#15181F',
    borderWidth: 1,
    borderColor: '#2A2E37',
    padding: 18,
    borderRadius: 16,
    marginBottom: 14,
  },
  infoBoxHighlight: {
    borderColor: '#FFD400',
    borderWidth: 1.5,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  labelIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  labelOnHighlight: {
    color: '#FFD400',
  },
  stationName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  remainBox: {
    backgroundColor: '#15181F',
    borderWidth: 1,
    borderColor: '#2A2E37',
    padding: 18,
    borderRadius: 16,
    marginBottom: 14,
    alignItems: 'center',
  },
  remainText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  remainCount: {
    fontSize: 40,
    fontWeight: '800',
    color: '#FFD400',
  },
  guideBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFC400',
    padding: 18,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    marginBottom: 14,
  },
  guideIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  guideText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: '#111111',
  },
  prepareBox: {
    backgroundColor: '#2A1A0A',
    borderWidth: 2,
    borderColor: '#E65100',
    padding: 14,
    borderRadius: 16,
    marginBottom: 14,
    alignItems: 'center',
  },
  prepareText: {
    fontSize: 16,
    color: '#FFA766',
    fontWeight: '800',
  },
});
