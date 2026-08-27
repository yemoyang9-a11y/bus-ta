import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { useRealtime } from '../realtime/RealtimeProvider';
import { stopBeaconScan } from '../ble/bleManager';

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

// 예모님 확정(2026-08-24): ON_BUS_AUTO/ON_BUS_CONFIRMED는 실제 운행 상태가 아니라
// "탑승 판정 방법"의 차이다. 서버 상태는 기존 tripStatus(WAITING_BUS/ON_BUS/...)를 그대로 쓰고,
// boardingMethod(AUTO_DETECTED | USER_CONFIRMED)와 boardingConfirmedAt으로 탑승 확정 여부와
// 방법을 구분한다. 화면 제목은 tripStatus 기준으로, "탑승 확정 여부"는 boardingConfirmedAt으로 판단한다.
const TITLE_BY_STATUS = {
  WAITING_BUS: '버스 탑승 대기',
  ON_BUS: '버스 탑승 중',
  NEAR_DESTINATION: '하차 준비',
  TRIP_DONE: '목적지 도착',
};

export default function RidingScreen({ route, navigation }) {
  const { tripId, selectedRoute } = route.params;
  const [status, setStatus] = useState(INITIAL_STATUS);
  const bellHandledRef = useRef(false);
  const requestCounterRef = useRef(0);
  const stoppedRef = useRef(false);
  const stoppingBeaconScanRef = useRef(false); // 예모님 P0-2: 중복 재시도 방지용 진행중 플래그
  const patchInFlightRef = useRef(false); // 유나님 확인(2026-08-15): PATCH 겹침 방지
  const { state, dispatch } = useTrip();
  const { session, isConnected } = useRealtime();

  // 최초 진입 안내
  // 유나님 확인(2026-08-15): Realtime 연결 중에는 expo-speech와 Realtime 음성이
  // 동시에 같은 내용을 말해서 중복 출력이 생긴다. Realtime이 연결됐을 때는
  // expo-speech 안내를 재생하지 않고, 연결 실패·미연결 시에만 대체 안내로 사용한다.
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

  // 정류장·상태 바뀔 때마다 TTS (1정거장 남은 경우는 아래 하차 안내 useEffect가 별도 처리)
  // 유나님 확인(2026-08-15): Realtime 연결 중이면 이 TTS는 재생하지 않는다.
  useEffect(() => {
    if (isConnected) return;
    if (status.guideMessage && status.remainingStations !== 1) {
      const timer = setTimeout(() => {
        Speech.speak(status.guideMessage, { language: 'ko' });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [status.guideMessage, status.remainingStations, isConnected]);

  // 정민님 확인(2026-08-12): 탑승 완료 시 비콘 스캔 중지
  // 예모님 확정(2026-08-24): "탑승 완료"는 boardingConfirmedAt이 존재하는 시점이다.
  // (AUTO_DETECTED든 USER_CONFIRMED든 방법과 무관하게, 확정 여부만 본다.)
  useEffect(() => {
    if (
      status.boardingConfirmedAt &&
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
  }, [status.boardingConfirmedAt, state.beaconScanActive]);

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

      if (data.tripStatus === 'TRIP_DONE' || data.tripStatus === 'CANCELLED') {
        stoppedRef.current = true;
        dispatch({ type: 'RESET_TRIP' });
      }
    } catch (error) {
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

  // 예모님 확정(2026-08-24): 정류장 상세 정보는 boardingConfirmedAt이 있을 때만 표시.
  // WAITING_BUS(탑승 전)에서는 대기 화면을 유지한다.
  const isBoarded = Boolean(status.boardingConfirmedAt);

  if (!isBoarded || !status.currentStation || !status.nextStation) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{TITLE_BY_STATUS[status.tripStatus] ?? '버스 탑승 대기'}</Text>
        <View style={styles.guideBox}>
          <Text style={styles.guideText}>{status.guideMessage}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{TITLE_BY_STATUS[status.tripStatus] ?? '버스 탑승 중'}</Text>

      <View style={styles.infoBox}>
        <Text style={styles.label}>현재 정류장</Text>
        <Text style={styles.stationName}>{status.currentStation.stationName}</Text>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.label}>다음 정류장</Text>
        <Text style={styles.stationName}>{status.nextStation.stationName}</Text>
      </View>

      <View style={styles.remainBox}>
        <Text style={styles.remainText}>남은 정류장</Text>
        <Text style={styles.remainCount}>{status.remainingStations}</Text>
      </View>

      <View style={styles.guideBox}>
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
    backgroundColor: '#fff',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  label: {
    fontSize: 13,
    color: '#888',
    marginBottom: 5,
  },
  stationName: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  remainBox: {
    backgroundColor: '#E3F2FD',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    alignItems: 'center',
  },
  remainText: {
    fontSize: 14,
    color: '#555',
  },
  remainCount: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  guideBox: {
    backgroundColor: '#FFF9C4',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  guideText: {
    fontSize: 16,
    color: '#333',
  },
  prepareBox: {
    backgroundColor: '#FFE0B2',
    padding: 12,
    borderRadius: 10,
    marginBottom: 15,
    alignItems: 'center',
  },
  prepareText: {
    fontSize: 16,
    color: '#E65100',
    fontWeight: 'bold',
  },
});