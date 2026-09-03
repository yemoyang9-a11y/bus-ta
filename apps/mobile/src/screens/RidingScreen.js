import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { useRealtime } from '../realtime/RealtimeProvider';
import { startBeaconScan, stopBeaconScan } from '../ble/bleManager';

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
  const stoppingBeaconScanRef = useRef(false);
  const startingBeaconScanRef = useRef(false);
  const patchInFlightRef = useRef(false);
  const arrivalPollFailureCountRef = useRef(0);
  const { state, dispatch } = useTrip();
  const { session, isConnected } = useRealtime();
  const currentTripStatus = state.tripStatus ?? status.tripStatus;
  const boardingConfirmedAt = state.boardingConfirmedAt ?? status.boardingConfirmedAt;

  // 예모님 재지적(2026-08-28, P1): 취소된 이전 운행에서 stoppedRef.current = true가
  // 남아있으면, 같은 Riding 화면 인스턴스가 재사용될 때(A 취소 후 B 선택) 새 tripId로도
  // GPS interval이 계속 멈춰있는 상태가 된다. tripId가 바뀔 때마다 정지 관련 ref들을
  // 새 운행 기준으로 초기화한다.
  useEffect(() => {
    stoppedRef.current = false;
    bellHandledRef.current = false;
    arrivalPollFailureCountRef.current = 0;
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
        Speech.speak('버스 위치를 확인하는 중입니다.', { language: 'ko' });
      }, 500);

      return () => {
        clearTimeout(timer);
        Speech.stop();
      };
    }, [isConnected])
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
  // startBeaconScan()을 호출한다. 음성 경로에서는 아직 RouteListScreen 즉시 시작 로직이
  // 남아있으므로 중복 시작 방지는 startBeaconScan/connectAll 쪽 멱등성에 맡긴다.
  useEffect(() => {
    if (
      status.shouldScanBeacon &&
      !state.beaconScanActive &&
      !startingBeaconScanRef.current
    ) {
      startingBeaconScanRef.current = true;
      startBeaconScan()
        .then(() => {
          dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: true });
        })
        .catch((error) => {
          console.log('신호 기반 비콘 스캔 시작 실패, 다음 주기에 재시도:', error);
        })
        .finally(() => {
          startingBeaconScanRef.current = false;
        });
    }
  }, [status.shouldScanBeacon, state.beaconScanActive]);

  // 정민님 확인(2026-08-12): 탑승 완료 시 비콘 스캔 중지
  useEffect(() => {
    if (
      boardingConfirmedAt &&
      state.beaconScanActive &&
      !stoppingBeaconScanRef.current
    ) {
      stoppingBeaconScanRef.current = true;
      stopBeaconScan()
        .then(() => {
          dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: false });
        })
        .catch((error) => {
          console.log('비콘 스캔 중지 실패, 다음 주기에 재시도:', error);
        })
        .finally(() => {
          stoppingBeaconScanRef.current = false;
        });
    }
  }, [boardingConfirmedAt, state.beaconScanActive]);

  // 예모님 지적(2026-08-27, P1) + 유나님 지적(2026-08-28): 취소 감지 시 GPS/BLE를 즉시 중지한다.
  // RESET_TRIP_KEEP_SEARCH·RESET_TRIP 모두 이제 beaconScanActive를 건드리지 않고 이전 값을
  // 그대로 보존하므로(TripContext.js 참고), 여기서 실제로 stopBeaconScan()을 호출해서
  // "성공"을 확인한 뒤에만 SET_BEACON_SCAN_ACTIVE(active: false)를 dispatch한다.
  const isThisTripStillActive = state.tripId === tripId;

  useEffect(() => {
    if (!isThisTripStillActive) {
      stoppedRef.current = true;
      if (state.beaconScanActive && !stoppingBeaconScanRef.current) {
        stoppingBeaconScanRef.current = true;
        stopBeaconScan()
          .then(() => {
            dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: false });
          })
          .catch((error) => {
            console.log('취소 후 비콘 스캔 중지 실패:', error);
          })
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

  // 실제 GPS로 2초 간격 PATCH /status 전송
  useEffect(() => {
    let interval;
    let isMounted = true;

    (async () => {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') {
        Speech.speak('위치 권한이 없어 운행 추적을 시작할 수 없습니다.', { language: 'ko' });
        navigation.navigate('Error');
        return;
      }

      interval = setInterval(async () => {
        if (!isMounted || stoppedRef.current) return;
        if (patchInFlightRef.current) return;
        await patchStatus();
      }, 2000);
    })();

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, [tripId]);

  // 효린님 확인(2026-08-28): WAITING_BUS 동안 서버가 알려준 주기로 GET /status를 반복
  // 호출해 도착정보를 갱신한다. 실패가 누적되면(20초 이상) 오류 화면으로 전환한다.
  useEffect(() => {
    if (currentTripStatus !== 'WAITING_BUS') {
      arrivalPollFailureCountRef.current = 0;
      return;
    }

    const intervalSeconds = status.arrivalPollIntervalSeconds ?? 15;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || stoppedRef.current) return;
      try {
        const latest = await apiClient.trips.getStatus(tripId);
        if (cancelled || stoppedRef.current || state.tripId !== tripId) return;
        arrivalPollFailureCountRef.current = 0;
        setStatus((prev) => ({ ...prev, ...latest }));
        dispatch({ type: 'UPDATE_TRIP_STATUS', status: latest });
      } catch (error) {
        arrivalPollFailureCountRef.current += 1;
        if (arrivalPollFailureCountRef.current * intervalSeconds >= 20) {
          stoppedRef.current = true;
          navigation.navigate('Error');
        }
      }
    };

    const interval = setInterval(poll, intervalSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentTripStatus, status.arrivalPollIntervalSeconds, tripId]);

  // PATCH /api/trips/{tripId}/status 호출
  const patchStatus = async () => {
    patchInFlightRef.current = true;
    try {
      const location = await Location.getCurrentPositionAsync({});
      requestCounterRef.current += 1;

      const data = await apiClient.trips.updateStatus(tripId, {
        requestId: `location-${tripId}-${requestCounterRef.current}`,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        recordedAt: new Date().toISOString(),
        source: 'GPS',
      });

      if (stoppedRef.current || state.tripId !== tripId) {
        return;
      }

      setStatus(data);
      dispatch({ type: 'UPDATE_TRIP_STATUS', status: data });
      session?.notifyStatusChange({
        tripStatus: data.tripStatus,
        boardingMethod: data.boardingMethod,
        boardingConfirmedAt: data.boardingConfirmedAt,
        remainingStations: data.remainingStations,
        currentStation: data.currentStation,
        bellStatus: data.bellStatus,
        guideMessage: data.guideMessage,
      });

      // 예모님 재지적(2026-08-28, P1): TRIP_DONE·TRIP_NOT_FOUND에서도 RESET_TRIP_KEEP_SEARCH와
      // 같은 이유로, 실제 stopBeaconScan()이 성공한 뒤에만 상태를 끄도록 순서를 지킨다.
      // TripContext.js의 RESET_TRIP이 이제 beaconScanActive를 건드리지 않으므로,
      // 여기서 실제 스캔 중지를 시도한 뒤 RESET_TRIP을 dispatch한다.
      if (data.tripStatus === 'TRIP_DONE') {
        stoppedRef.current = true;
        await stopBeaconScanIfActive();
        dispatch({ type: 'RESET_TRIP' });
      } else if (data.tripStatus === 'CANCELLED') {
        stoppedRef.current = true;
        dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' });
      }
    } catch (error) {
      if (stoppedRef.current || state.tripId !== tripId) {
        return;
      }
      if (error instanceof ApiError) {
        if (error.errorCode === 'INVALID_TRIP_STATUS') {
          stoppedRef.current = true;
          try {
            const latest = await apiClient.trips.getStatus(tripId);
            setStatus(latest);
            dispatch({ type: 'UPDATE_TRIP_STATUS', status: latest });
            session?.notifyStatusChange({
              tripStatus: latest.tripStatus,
              boardingMethod: latest.boardingMethod,
              boardingConfirmedAt: latest.boardingConfirmedAt,
              remainingStations: latest.remainingStations,
              currentStation: latest.currentStation,
              bellStatus: latest.bellStatus,
              guideMessage: latest.guideMessage,
            });
          } catch {
            // 최신 상태 조회도 실패하면 오류 화면으로
          }
          return;
        }
        if (error.errorCode === 'TRIP_NOT_FOUND') {
          stoppedRef.current = true;
          await stopBeaconScanIfActive();
          dispatch({ type: 'RESET_TRIP' });
          navigation.navigate('Error');
          return;
        }
      }
      console.log('위치 업데이트 실패:', error);
    } finally {
      patchInFlightRef.current = false;
    }
  };

  // 예모님 재지적(2026-08-28, P1): TRIP_DONE·TRIP_NOT_FOUND에서 RESET_TRIP을 dispatch하기
  // 전에 실제 스캔이 켜져 있으면 stopBeaconScan()을 먼저 호출해서 성공을 기다린다.
  // 실패해도 RESET_TRIP은 진행하되(운행 자체는 끝난 상태), 다음 취소 감지 useEffect가
  // beaconScanActive가 남아있으면 다시 시도할 수 있도록 상태는 여기서 강제로 끄지 않는다.
  const stopBeaconScanIfActive = async () => {
    if (!state.beaconScanActive || stoppingBeaconScanRef.current) return;
    stoppingBeaconScanRef.current = true;
    try {
      await stopBeaconScan();
      dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: false });
    } catch (error) {
      console.log('종료 시 비콘 스캔 중지 실패, 취소 감지 로직이 재시도함:', error);
    } finally {
      stoppingBeaconScanRef.current = false;
    }
  };

  const handleAlightNavigation = () => {
    if (bellHandledRef.current) return;
    bellHandledRef.current = true;
    stoppedRef.current = true;
    Speech.stop();

    navigation.navigate('Alight', {
      tripId,
      bellRequestId: status.bellRequestId,
      command: status.command,
      guideMessage: status.guideMessage,
    });
  };

  const isBoarded = Boolean(status.boardingConfirmedAt);

  if (!isBoarded || !status.currentStation || !status.nextStation) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{screenTitle}</Text>
        <Text style={styles.subtitle}>지정한 목적지까지 안전하게 안내합니다.</Text>

        <View style={styles.guideBox}>
          <Text style={styles.guideIcon}>🔊</Text>
          <Text style={styles.guideText}>{status.guideMessage}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{screenTitle}</Text>
      <Text style={styles.subtitle}>지정한 목적지까지 안전하게 안내합니다.</Text>

      <View style={styles.infoBox}>
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>📍</Text>
          <Text style={styles.label}>현재 정류장</Text>
        </View>
        <Text style={styles.stationName}>{status.currentStation.stationName}</Text>
      </View>

      <View style={[styles.infoBox, styles.infoBoxHighlight]}>
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>➡️</Text>
          <Text style={[styles.label, styles.labelOnHighlight]}>다음 정류장</Text>
        </View>
        <Text style={styles.stationName}>{status.nextStation.stationName}</Text>
      </View>

      <View style={styles.remainBox}>
        <View style={styles.labelRow}>
          <Text style={styles.labelIcon}>ℹ️</Text>
          <Text style={styles.remainText}>남은 정류장</Text>
        </View>
        <Text style={styles.remainCount}>{status.remainingStations}</Text>
      </View>

      <View style={styles.guideBox}>
        <Text style={styles.guideIcon}>🔊</Text>
        <Text style={styles.guideText}>{status.guideMessage}</Text>
      </View>

      {status.remainingStations === 2 && (
        <View style={styles.prepareBox}>
          <Text style={styles.prepareText}>⚠️ 곧 하차 준비하세요</Text>
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