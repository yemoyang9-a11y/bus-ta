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
  disconnectBellsForTrip,
  startBeaconScan,
  stopBeaconScan,
  disconnectCane,
} from '../ble/bleManager';
import { createAssistDeviceStatusEvent } from '../realtime/assist-device-status';
import { canStartBeaconScan } from '../ble/beacon-scan-gate';
import {
  startBeaconScanWithRetry,
  stopBeaconScanWithRetry,
} from '../ble/beacon-scan-controller';
import { releaseCaneAfterBoarding } from '../ble/cane-release-controller';
import { connectBellWithRetry } from '../ble/bell-connect-controller';

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
  const {
    session,
    isConnected,
    notifyFailure,
    getActiveTripId,
  } = useRealtime();

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

  // 지팡이 연결을 이미 놓아줬는지. 스캔이 꺼진 뒤 effect 가 다시 돌 때 중복 해지를 막는다.
  const caneReleasedRef = useRef(false);
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
          dispatch({
            type: 'SET_BEACON_SCAN_ACTIVE',
            active: true,
          });
        },

        onStartedTooLate: () =>
          stopBeaconScanWithRetry({
            stopBeaconScan,
            onStopped: () => undefined,
            onGaveUp: (error) => {
              console.log(
                '늦게 성공한 스캔을 되돌리지 못함:',
                error,
              );
              dispatch({
                type: 'SET_BEACON_SCAN_ACTIVE',
                active: true,
              });
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

  // 탑승이 확정되면 스캔을 멈추고 지팡이 연결까지 놓아준다.
  //
  // 승차 안내(버스 접근 진동)가 끝났는데 연결이 남으면 지팡이 배터리를 계속 쓴다.
  // 순서는 releaseCaneAfterBoarding 이 지킨다 — 스캔 중지가 실제로 성공한 뒤에만
  // 끊는다. 먼저 끊으면 중지 명령이 전달되지 않아 탑승 뒤에도 계속 진동한다.
  useEffect(() => {
    if (!boardingConfirmedAt || stoppingBeaconScanRef.current) return;
    if (!state.beaconScanActive && caneReleasedRef.current) return;

    stoppingBeaconScanRef.current = true;

    releaseCaneAfterBoarding({
      beaconScanActive: state.beaconScanActive,
      stopBeaconScan,
      disconnectCane,
      onStopped: () => {
        dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: false });
      },
      onReleased: () => {
        caneReleasedRef.current = true;
      },
      onFailed: (stage, error) => {
        console.log(
          stage === 'STOP'
            ? '탑승 확정 후 비콘 스캔 중지를 상한까지 재시도했지만 실패:'
            : '탑승 확정 후 지팡이 연결 해지 실패:',
          error,
        );
      },
      wait: waitBeforeRetry,
    }).finally(() => {
      stoppingBeaconScanRef.current = false;
    });
  }, [boardingConfirmedAt, state.beaconScanActive]);

  // 탑승이 확정되면 하차벨 보드를 연결한다.
  //
  // GPS watch 중단이나 하차 화면 이동은 운행 취소가 아니다.
  // 실제 운행이 취소되거나 다른 운행으로 교체됐는지만 확인한다.
  useEffect(() => {
    if (
      getActiveTripId() !== tripId ||
      !boardingConfirmedAt ||
      state.bellConnected !== null ||
      connectingBellRef.current === tripId
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

      notifyFailure(
        createAssistDeviceStatusEvent({
          device: 'BELL',
          reason: 'NOT_CONNECTED',
          attempted: false,
          retryable: false,
        }),
      );

      return;
    }

    connectingBellRef.current = tripId;
    const attemptTripId = tripId;

    const isStillWanted = () =>
      isScreenTripActive(
        getActiveTripId(),
        attemptTripId,
      );

    connectBellWithRetry({
      connectBell: () =>
        connectBell(targetBeaconId, attemptTripId),

      isStillWanted,

      onConnected: () => {
        dispatch({
          type: 'SET_BELL_CONNECTED',
          connected: true,
        });
      },

      onConnectedTooLate: () =>
        disconnectBellsForTrip(attemptTripId),

      onGaveUp: () => {
        dispatch({
          type: 'SET_BELL_CONNECTED',
          connected: false,
        });

        notifyFailure(
          createAssistDeviceStatusEvent({
            device: 'BELL',
            reason: 'NOT_CONNECTED',
            attempted: true,
            retryable: false,
          }),
        );
      },

      onCancelled: () => {
        if (
          isScreenTripActive(
            getActiveTripId(),
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
      if (
        connectingBellRef.current === attemptTripId
      ) {
        connectingBellRef.current = false;
      }
    });
  }, [
    boardingConfirmedAt,
    state.bellConnected,
    state.targetBeaconId,
    state.beaconPreparationCompleted,
    tripId,
    state.tripId,
  ]);

  // 취소 감지 시 GPS/BLE를 즉시 중지한다.
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

      if (
        cancelled ||
        stoppedRef.current
      ) {
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