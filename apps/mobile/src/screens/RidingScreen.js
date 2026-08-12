import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';

const INITIAL_STATUS = {
  currentStation: null,
  nextStation: null,
  remainingStations: null,
  tripStatus: 'WAITING_BUS',
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
  const { dispatch } = useTrip();

  // 최초 진입 안내
  useFocusEffect(
    React.useCallback(() => {
      const timer = setTimeout(() => {
        Speech.speak('버스 위치를 확인하는 중입니다.', { language: 'ko' });
      }, 500);

      return () => {
        clearTimeout(timer);
        Speech.stop();
      };
    }, [])
  );

  // 정류장·상태 바뀔 때마다 TTS (1정거장 남은 경우는 아래 하차 안내 useEffect가 별도 처리)
  useEffect(() => {
    if (status.guideMessage && status.remainingStations !== 1) {
      const timer = setTimeout(() => {
        Speech.speak(status.guideMessage, { language: 'ko' });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [status.guideMessage, status.remainingStations]);

  // 1정거장 남았을 때 TTS 출력 후 하차 안내 화면 전환
  // API_SPEC.md 기준:
  // - bellRequestId는 백엔드가 PATCH /status 응답에서 생성한 값 (프론트 생성 금지)
  // - shouldTriggerBell: true + bellStatus: PENDING + bellRequestId 존재 시 실행
  useEffect(() => {
    if (
      status.shouldTriggerBell === true &&
      status.bellStatus === 'PENDING' &&
      status.remainingStations === 1 &&
      status.bellRequestId &&
      status.command === 'STOP_REQUEST' &&
      !bellHandledRef.current
    ) {
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
  }, [status]);

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
        await patchStatus();
      }, 3000);
    })();

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, [tripId]);

  // PATCH /api/trips/{tripId}/status 호출
  // requestId는 앱이 생성하는 멱등 키 — 같은 좌표 재전송 시에는 재사용하지 않고 매 전송마다 새로 발급한다
  const patchStatus = async () => {
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

      // 9.2: 종료된 운행이면 전송 중단
      if (data.tripStatus === 'TRIP_DONE' || data.tripStatus === 'CANCELLED') {
        stoppedRef.current = true;
        dispatch({ type: 'RESET_TRIP' });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.errorCode === 'INVALID_TRIP_STATUS') {
          // 앱 상태가 실제 운행 상태보다 뒤처짐 — 전송 중단하고 최신 상태로 맞춤
          stoppedRef.current = true;
          try {
            const latest = await apiClient.trips.getStatus(tripId);
            setStatus(latest);
            dispatch({ type: 'UPDATE_TRIP_STATUS', status: latest });
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
      // 네트워크 실패 등은 다음 주기에 재시도 (requestId는 다음 좌표에 새로 발급되므로 중복 걱정 없음)
      console.log('위치 업데이트 실패:', error);
    }
  };

  // 하차 안내 화면으로 이동
  const handleAlightNavigation = () => {
    if (bellHandledRef.current) return;
    bellHandledRef.current = true;

    navigation.navigate('Alight', {
      tripId,
      bellRequestId: status.bellRequestId,
      command: status.command,
      guideMessage: status.guideMessage,
    });
  };

  if (!status.currentStation || !status.nextStation) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>탑승 중</Text>
        <View style={styles.guideBox}>
          <Text style={styles.guideText}>{status.guideMessage}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>탑승 중</Text>

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