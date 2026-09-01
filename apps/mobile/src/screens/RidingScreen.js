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
};

export default function RidingScreen({ route, navigation }) {
  const { tripId, selectedRoute } = route.params;
  const [status, setStatus] = useState(INITIAL_STATUS);
  const bellHandledRef = useRef(false);
  const requestCounterRef = useRef(0);
  const stoppedRef = useRef(false);
  // 통신이 실패하면 서버 상태를 알 수 없다. 마지막으로 확인된 상태를 들고 있다가
  // 대기 중이었을 때만 연결 복구를 재시도한다 — 탑승 뒤에는 폴링할 이유가 없다.
  const lastKnownStatusRef = useRef('WAITING_BUS');
  const stoppingBeaconScanRef = useRef(false); // 예모님 P0-2: 중복 재시도 방지용 진행중 플래그
  const patchInFlightRef = useRef(false);
  const { state, dispatch } = useTrip();
  const { session, isConnected } = useRealtime();
  const currentTripStatus = state.tripStatus ?? status.tripStatus;
  const boardingConfirmedAt = state.boardingConfirmedAt ?? status.boardingConfirmedAt;

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

  // ── 도착정보 반복 조회 + 비콘 스캔 시작 ─────────────────────────────
  // 지금까지 GET /status 를 부르는 곳은 사용자가 "몇 분 남았어?"라고 물었을 때뿐이라,
  // 가만히 기다리는 동안에는 도착 예정 시간이 갱신되지 않았다. 서버가 응답에
  // nextArrivalRefreshInMs 로 "다음엔 언제 물어봐"를 알려주므로 그 주기로 다시 부른다.
  // 주기를 앱이 스스로 정하지 않는 이유는 서버의 호출 정책과 어긋나지 않게 하기 위함이다.
  useEffect(() => {
    if (!tripId) return;
    let timer;
    let cancelled = false;

    const pollArrival = async () => {
      if (cancelled || stoppedRef.current) return;
      try {
        const latest = await apiClient.trips.getStatus(tripId);
        if (cancelled) return;
        lastKnownStatusRef.current = latest.tripStatus;
        setStatus(latest);
        dispatch({ type: 'UPDATE_TRIP_STATUS', status: latest });

        // 서버가 "지금 켜라"고 할 때만 켠다. 한 번 켜면 끄지 않는다 — 앞차가 떠나면
        // 도착 예정 시간이 다시 늘어나는데, 그때 끄면 정작 버스가 눈앞에 왔을 때
        // 스캔이 꺼져 있다. 끄는 것은 탑승 확정 시점의 아래 useEffect 가 맡는다.
        if (latest.shouldScanBeacon && !state.beaconScanActive) {
          try {
            await startBeaconScan();
            if (!cancelled) dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: true });
          } catch (error) {
            console.log('비콘 스캔 시작 실패, 다음 주기에 재시도:', error);
          }
        }

        // 서버가 주기를 알려주지 않으면 반복하지 않는다. 앱이 임의 주기를 만들면
        // GBIS 호출 정책이 앱 쪽에서 깨진다. 서버는 WAITING_BUS 일 때만 주기를 주므로,
        // 탑승이 확정되면 이 폴링은 자연히 멈춘다.
        if (
          !cancelled &&
          latest.tripStatus === 'WAITING_BUS' &&
          typeof latest.nextArrivalRefreshInMs === 'number'
        ) {
          timer = setTimeout(pollArrival, Math.max(1000, latest.nextArrivalRefreshInMs));
        }
      } catch (error) {
        // 통신 실패라 서버가 준 주기를 알 수 없다. 이건 도착정보 갱신 주기가 아니라
        // 연결 복구용 재시도다. 최소 간격(20초)을 그대로 써서 실패 중에도 호출이
        // 늘어나지 않게 한다. 마지막으로 확인된 상태가 대기 중일 때만 재시도한다.
        console.log('도착정보 조회 실패, 연결 복구용으로 20초 뒤 재시도:', error);
        if (!cancelled && lastKnownStatusRef.current === 'WAITING_BUS') {
          timer = setTimeout(pollArrival, 20000);
        }
      }
    };

    pollArrival();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tripId, state.beaconScanActive]);

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

  // 예모님 재지적(2026-08-27, P1): 기존 코드는 state.tripId && state.tripId !== tripId 였는데,
  // RESET_TRIP_KEEP_SEARCH가 state.tripId를 null로 만들기 때문에 "state.tripId &&" 조건에서
  // 걸러져서 정상 취소 시에는 이 로직이 아예 실행되지 않았다.
  // 이 화면의 tripId(=route.params, 취소돼도 안 바뀜)가 활성 상태인지는
  // "state.tripId가 이 화면의 tripId와 다르다"가 아니라
  // "state.tripId가 이 화면의 tripId가 아니게 됐다(null 포함)"로 판단해야 한다.
  const isThisTripStillActive = state.tripId === tripId;

  useEffect(() => {
    if (!isThisTripStillActive) {
      // Context의 활성 운행이 이 화면의 tripId와 달라졌다(취소되었거나 다른 운행으로 바뀜).
      stoppedRef.current = true;
      if (state.beaconScanActive) {
        stopBeaconScan()
          .then(() => {
            dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: false });
          })
          .catch((error) => {
            console.log('취소 후 비콘 스캔 중지 실패:', error);
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

  // 실제 GPS로 3초 간격 PATCH /status 전송
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
      }, 3000);
    })();

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, [tripId]);

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

      // 예모님 지적(2026-08-27, P2): await 이후 응답을 반영하기 전에, 그 사이 이 운행이
      // 취소되거나 다른 운행으로 바뀌지 않았는지 재확인한다. 취소 직전 요청의 늦은 응답이
      // 취소 후 화면·Context·Realtime 세션에 다시 반영되는 것을 막는다.
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

      if (data.tripStatus === 'TRIP_DONE') {
        stoppedRef.current = true;
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