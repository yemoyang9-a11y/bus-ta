import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { isScreenTripActive } from '../state/trip-transition';
import { useRealtime } from '../realtime/RealtimeProvider';
import { toTripStatusSnapshot } from '../realtime/status-snapshot';
import {
  connectBell,
  disconnect,
  startBeaconScan,
  stopBeaconScan,
} from '../ble/bleManager';
import { canStartBeaconScan } from '../ble/beacon-scan-gate';
import {
  startBeaconScanWithRetry,
  stopBeaconScanWithRetry,
} from '../ble/beacon-scan-controller';
import {
  connectBellWithRetry,
  disconnectBellWithRetry,
} from '../ble/bell-connect-controller';

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

  const activeTripIdRef = useRef(state.tripId);
  activeTripIdRef.current = state.tripId;

  const boardingConfirmedAtRef = useRef(boardingConfirmedAt);
  boardingConfirmedAtRef.current = boardingConfirmedAt;

  const waitBeforeRetry = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

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

  useEffect(() => {
    if (isConnected) return;

    if (status.guideMessage && status.remainingStations !== 1) {
      const timer = setTimeout(() => {
        Speech.speak(status.guideMessage, { language: 'ko' });
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [status.guideMessage, status.remainingStations, isConnected]);

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
          stopBeaconScanWithRetry({
            stopBeaconScan,
            onStopped: () => undefined,
            onGaveUp: (error) => {
              console.log('늦게 성공한 스캔을 되돌리지 못함:', error);
              dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: true });
            },
            wait: waitBeforeRetry,
          }),
        onGaveUp: (error) => {
          console.log(
            '비콘 스캔 시작을 상한까지 재시도했지만 실패:',
            error,
          );
          Speech.speak(
            '지팡이 진동 안내를 시작하지 못했습니다. 정류장에 계신 주변 분께 버스가 오면 알려 달라고 요청해 주세요.',
            { language: 'ko' },
          );
        },
        wait: (ms) =>
          new Promise((resolve) => setTimeout(resolve, ms)),
      }).finally(() => {
        startingBeaconScanRef.current = false;
      });
    }
  }, [
    status.shouldScanBeacon,
    state.caneReady,
    state.beaconScanActive,
  ]);

  useEffect(() => {
    if (
      boardingConfirmedAt &&
      state.beaconScanActive &&
      !stoppingBeaconScanRef.current
    ) {
      stoppingBeaconScanRef.current = true;

      runStopBeaconScan(
        '탑승 확정 후 비콘 스캔 중지를 상한까지 재시도했지만 실패:',
      ).finally(() => {
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
  // P0 수정:
  // GPS watch 중단이나 하차 화면 이동은 "운행 취소"가 아니다. 따라서 stoppedRef를
  // 하차벨 연결 생명주기에 사용하지 않는다. 이 연결을 시작한 운행이 여전히 현재
  // 운행인지 여부만 확인한다.
  //
  // 연결할 보드 이름은 서버가 노선별로 내려준 targetBeaconId를 쓴다.
  useEffect(() => {
    if (
      !boardingConfirmedAt ||
      state.bellConnected !== null ||
      connectingBellRef.current
    ) {
      return;
    }

    const targetBeaconId = state.targetBeaconId;

    if (!targetBeaconId) {
      if (!state.beaconPreparationCompleted) {
        console.log(
          '[BLE] targetBeaconId 준비 중 - 비콘 조회 완료까지 하차벨 연결 대기',
        );
        return;
      }

      console.log(
        '[BLE] 비콘 준비 완료 후에도 targetBeaconId 없음 - 하차벨 연결을 시작하지 않음',
      );
      dispatch({
        type: 'SET_BELL_CONNECTED',
        connected: false,
      });
      Speech.speak(
        '하차벨 정보를 확인하지 못했습니다. 내리기 전에 기사님께 직접 말씀해 주세요.',
        { language: 'ko' },
      );
      return;
    }

    connectingBellRef.current = true;
    const attemptTripId = tripId;

    // 화면 전환/GPS 중단과 하차벨 연결 생명주기를 분리한다.
    // 이 effect가 시작된 운행이 실제로 취소되거나 다른 운행으로 교체된 경우에만
    // 연결을 중단한다.
    const isStillWanted = () =>
      isScreenTripActive(activeTripIdRef.current, attemptTripId);

    connectBellWithRetry({
      connectBell: () => connectBell(targetBeaconId),
      isStillWanted,

      onConnected: () => {
        // 성공 콜백 직전에도 controller가 같은 운행인지 확인한다.
        dispatch({
          type: 'SET_BELL_CONNECTED',
          connected: true,
        });
      },

      onConnectedTooLate: () =>
        // A 운행에서 시작한 연결이 B 운행으로 바뀐 뒤 늦게 성공했다면,
        // 전역 bellDeviceName이 아니라 A가 실제 사용했던 targetBeaconId로 끊는다.
        disconnectBellWithRetry({
          disconnectBell: () => disconnect(targetBeaconId),
          onGaveUp: (error) => {
            console.log(
              '늦게 성공한 하차벨 연결을 상한까지 끊지 못함:',
              error,
            );
          },
          wait: waitBeforeRetry,
        }),

      onGaveUp: () => {
        // controller가 같은 운행임을 확인한 뒤에만 이 콜백을 호출한다.
        dispatch({
          type: 'SET_BELL_CONNECTED',
          connected: false,
        });

        Speech.speak(
          '하차벨에 연결하지 못했습니다. 내리기 전에 기사님께 직접 말씀해 주세요.',
          { language: 'ko' },
        );
      },

      onCancelled: () => {
        /**
         * A 운행 연결 작업이 취소된 이유가 이미 B 운행으로 바뀌었기 때문이라면
         * A의 늦은 콜백이 B의 bellConnected 상태를 false로 덮으면 안 된다.
         *
         * 아직 같은 운행인데 controller가 취소된 경우에만 false를 기록한다.
         */
        if (
          isScreenTripActive(
            activeTripIdRef.current,
            attemptTripId,
          )
        ) {
          dispatch({
            type: 'SET_BELL_CONNECTED',
            connected: false,
          });
        }
      },

      wait: waitBeforeRetry,
    }).finally(() => {
      connectingBellRef.current = false;
    });
  }, [
    boardingConfirmedAt,
    state.bellConnected,
    state.targetBeaconId,
    state.beaconPreparationCompleted,
  ]);

  // 취소 감지 시 GPS/BLE를 즉시 중지한다.
  // RESET_TRIP_KEEP_SEARCH·RESET_TRIP 모두 beaconScanActive를 그대로 보존하므로,
  // 여기서 실제 stopBeaconScan() 성공을 확인한 뒤에만
  // SET_BEACON_SCAN_ACTIVE(active: false)를 dispatch한다.
  const isThisTripStillActive =
    isScreenTripActive(state.tripId, tripId);

  useEffect(() => {
    if (!isThisTripStillActive) {
      stopLocationWatch();

      if (
        state.beaconScanActive &&
        !stoppingBeaconScanRef.current
      ) {
        stoppingBeaconScanRef.current = true;

        runStopBeaconScan(
          '취소 후 비콘 스캔 중지를 상한까지 재시도했지만 실패:',
        ).finally(() => {
          stoppingBeaconScanRef.current = false;
        });
      }
    }
  }, [
    isThisTripStillActive,
    state.beaconScanActive,
  ]);

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
            if (
              cancelled ||
              stoppedRef.current
            ) {
              return;
            }

            const callbackReceivedAt = Date.now();
            const locationTimestamp =
              Number(location.timestamp);

            if (
              !Number.isFinite(locationTimestamp)
            ) {
              console.warn(
                '[GPS] location.timestamp 없음 - PATCH하지 않음',
                {
                  callbackReceivedAt:
                    new Date(
                      callbackReceivedAt,
                    ).toISOString(),
                  accuracy:
                    location.coords.accuracy,
                  latitude:
                    location.coords.latitude,
                  longitude:
                    location.coords.longitude,
                },
              );

              return;
            }

            const locationAgeMs =
              Math.max(
                0,
                callbackReceivedAt -
                  locationTimestamp,
              );

            if (
              !firstLocationFixReceivedRef.current
            ) {
              firstLocationFixReceivedRef.current =
                true;

              console.log(
                '[GPS] 첫 fix 수신',
                {
                  receivedAt:
                    new Date(
                      callbackReceivedAt,
                    ).toISOString(),
                  watchToFirstFixMs:
                    locationWatchStartedAtRef.current ==
                    null
                      ? null
                      : callbackReceivedAt -
                        locationWatchStartedAtRef.current,
                  locationTimestamp:
                    new Date(
                      locationTimestamp,
                    ).toISOString(),
                  locationAgeMs,
                  accuracy:
                    location.coords.accuracy,
                },
              );
            }

            console.log('[GPS] fix 수신', {
              callbackReceivedAt:
                new Date(
                  callbackReceivedAt,
                ).toISOString(),
              locationTimestamp:
                new Date(
                  locationTimestamp,
                ).toISOString(),
              locationAgeMs,
              accuracy:
                location.coords.accuracy,
              latitude:
                location.coords.latitude,
              longitude:
                location.coords.longitude,
            });

            if (patchInFlightRef.current) {
              locationPatchSkippedCountRef.current += 1;

              console.log(
                '[GPS] PATCH in-flight로 fix 건너뜀',
                {
                  skippedCount:
                    locationPatchSkippedCountRef.current,
                  callbackReceivedAt:
                    new Date(
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

      if (
        cancelled ||
        stoppedRef.current
      ) {
        subscription.remove();

        console.log(
          '[GPS] 늦게 생성된 watch 구독 즉시 해제',
          {
            tripId,
            endedAt:
              new Date().toISOString(),
          },
        );

        return;
      }

      if (
        locationSubscriptionRef.current
      ) {
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
      console.log(
        '[GPS] watch 시작 실패:',
        error,
      );

      if (
        !cancelled &&
        !stoppedRef.current
      ) {
        stopLocationWatch();
        navigation.navigate('Error');
      }
    });

    return () => {
      cancelled = true;
      stopLocationWatch();

      console.log('[GPS] watch 구독 종료', {
        tripId,
        endedAt:
          new Date().toISOString(),
        skippedCount:
          locationPatchSkippedCountRef.current,
      });
    };
  }, [tripId]);

  useEffect(() => {
    if (
      currentTripStatus !== 'WAITING_BUS'
    ) {
      arrivalPollFailureCountRef.current = 0;
      return;
    }

    const intervalSeconds =
      status.arrivalPollIntervalSeconds ?? 15;

    let cancelled = false;

    const poll = async () => {
      if (
        cancelled ||
        stoppedRef.current
      ) {
        return;
      }

      try {
        const latest =
          await apiClient.trips.getStatus(
            tripId,
          );

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

        session?.notifyStatusChange(
          toTripStatusSnapshot(latest),
        );
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

  const patchStatus = async (
    location,
    callbackReceivedAt = Date.now(),
  ) => {
    patchInFlightRef.current = true;

    const patchStartedAt = Date.now();
    const locationTimestamp =
      Number(location.timestamp);

    const locationAgeMs =
      Number.isFinite(locationTimestamp)
        ? Math.max(
            0,
            callbackReceivedAt -
              locationTimestamp,
          )
        : null;

    requestCounterRef.current += 1;

    const requestId =
      `location-${tripId}-${requestCounterRef.current}`;

    try {
      if (
        !Number.isFinite(locationTimestamp)
      ) {
        console.warn(
          '[GPS] PATCH 중단 - location.timestamp 없음',
          {
            requestId,
            callbackReceivedAt:
              new Date(
                callbackReceivedAt,
              ).toISOString(),
            accuracy:
              location.coords.accuracy,
          },
        );

        return;
      }

      console.log('[GPS] PATCH 시작', {
        requestId,
        startedAt:
          new Date(
            patchStartedAt,
          ).toISOString(),
        callbackReceivedAt:
          new Date(
            callbackReceivedAt,
          ).toISOString(),
        locationTimestamp:
          new Date(
            locationTimestamp,
          ).toISOString(),
        locationAgeMs,
        accuracy:
          location.coords.accuracy,
        latitude:
          location.coords.latitude,
        longitude:
          location.coords.longitude,
      });

      const data =
        await apiClient.trips.updateStatus(
          tripId,
          {
            requestId,
            latitude:
              location.coords.latitude,
            longitude:
              location.coords.longitude,
            recordedAt:
              new Date(
                locationTimestamp,
              ).toISOString(),
            source: 'GPS',
          },
        );

      console.log('[GPS] PATCH 완료', {
        requestId,
        completedAt:
          new Date().toISOString(),
        durationMs:
          Date.now() -
          patchStartedAt,
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

      session?.notifyStatusChange(
        toTripStatusSnapshot(data),
      );

      if (
        data.tripStatus === 'TRIP_DONE'
      ) {
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
        failedAt:
          new Date().toISOString(),
        durationMs:
          Date.now() -
          patchStartedAt,
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

      if (
        error instanceof ApiError
      ) {
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

            session?.notifyStatusChange(
              toTripStatusSnapshot(latest),
            );
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

  const stopBeaconScanIfActive =
    async () => {
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
        stoppingBeaconScanRef.current =
          false;
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
      bellRequestId:
        status.bellRequestId,
      command:
        status.command,
      guideMessage:
        status.guideMessage,
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