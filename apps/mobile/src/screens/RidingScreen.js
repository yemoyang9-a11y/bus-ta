import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';

// =============================================
// [백엔드 연결 시 수정 1] API 주소 변경
// 'http://백엔드IP:포트' → ngrok 주소로 변경
// 예: 'https://abc123.ngrok.io'
// =============================================
const API_BASE_URL = 'http://백엔드IP:포트';

// =============================================
// 백엔드 연결 전 임시 mock 데이터
// 백엔드 연결 후에는 PATCH /api/trips/{tripId}/status 응답으로 대체됨
// [백엔드 연결 시 수정 2] isBackendConnected = true로 변경하면 이 데이터 안 쓰임
// =============================================
const MOCK_STATUSES = [
  {
    currentStation: { stationName: '수원대학교', latitude: 37.213789, longitude: 126.979772, sequence: 0 },
    nextStation: { stationName: '융건릉사거리', latitude: 37.207917, longitude: 126.987467, sequence: 2 },
    remainingStations: 3,
    tripStatus: 'ON_BUS',
    shouldTriggerBell: false,
    bellStatus: 'NOT_REQUESTED',
    bellRequestId: null,
    command: null,
    guideMessage: '버스에 탑승했습니다. 3정거장 남았습니다.',
  },
  {
    currentStation: { stationName: '융건릉사거리', latitude: 37.207917, longitude: 126.987467, sequence: 2 },
    nextStation: { stationName: '중외제약사거리', latitude: 37.201489, longitude: 127.003042, sequence: 4 },
    remainingStations: 2,
    tripStatus: 'NEAR_DESTINATION',
    shouldTriggerBell: false,
    bellStatus: 'NOT_REQUESTED',
    bellRequestId: null,
    command: null,
    guideMessage: '2정거장 남았습니다. 하차 준비를 시작하세요.',
  },
  {
    currentStation: { stationName: '중외제약사거리', latitude: 37.201489, longitude: 127.003042, sequence: 4 },
    nextStation: { stationName: '병점역후문', latitude: 37.20601, longitude: 127.032047, sequence: 10 },
    remainingStations: 1,
    tripStatus: 'NEAR_DESTINATION',
    shouldTriggerBell: true,
    bellStatus: 'PENDING',
    bellRequestId: 'bell-request-001',
    command: 'STOP_REQUEST',
    guideMessage: '하차까지 한 정류장 남았습니다. 다음 정류장에서 하차하세요.',
  },
];

// mock GPS 좌표 시퀀스
// 백엔드 연결 후 isBackendConnected = true로 변경하면 실제 PATCH /status 호출 시 사용됨
const MOCK_COORDINATES = [
  { latitude: 37.213789, longitude: 126.979772 },
  { latitude: 37.207917, longitude: 126.987467 },
  { latitude: 37.201489, longitude: 127.003042 },
];

export default function RidingScreen({ route, navigation }) {
  const { tripId, selectedRoute } = route.params;
  const [status, setStatus] = useState(MOCK_STATUSES[0]);
  const [mockIndex, setMockIndex] = useState(0);
  const bellHandledRef = useRef(false);
  const mockCoordIndexRef = useRef(0);

  // =============================================
  // [백엔드 연결 시 수정 2] false → true로 변경
  // true로 변경하면:
  // - 시연용 버튼 자동으로 사라짐
  // - 3초마다 PATCH /api/trips/{tripId}/status 자동 호출
  // - mock 데이터 대신 백엔드 실제 데이터 사용
  // =============================================
  const isBackendConnected = false;

  // 처음 탑승 중 화면 들어올 때 TTS 실행
  // 이전 화면 TTS와 겹치지 않도록 500ms 딜레이 적용
  useFocusEffect(
    React.useCallback(() => {
      const timer = setTimeout(() => {
        if (MOCK_STATUSES[0].guideMessage) {
          Speech.speak(MOCK_STATUSES[0].guideMessage, { language: 'ko' });
        }
      }, 500);

      return () => {
        clearTimeout(timer);
        Speech.stop();
      };
    }, [])
  );

  // 정류장 바뀔 때마다 TTS 실행
  // 1정거장은 아래 useEffect에서 TTS + 하차 안내 처리를 같이 하므로 여기서 제외
  // 첫 화면(mockIndex === 0)은 useFocusEffect에서 처리하므로 여기서 제외
  useEffect(() => {
    if (mockIndex === 0) return;
    if (status.guideMessage && status.remainingStations !== 1) {
      const timer = setTimeout(() => {
        Speech.speak(status.guideMessage, { language: 'ko' });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // 1정거장 남았을 때 TTS 출력 후 하차 안내 화면 전환
  // API_SPEC.md 기준:
  // - bellRequestId는 백엔드가 PATCH /status 응답에서 생성한 값 (프론트 생성 금지)
  // - /bell/request API는 사용하지 않음
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

  // 백엔드 연결 후 3초마다 PATCH /status 자동 호출
  // isBackendConnected = true일 때만 실행됨
  useEffect(() => {
    if (!isBackendConnected) return;

    const interval = setInterval(async () => {
      await patchStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, [isBackendConnected]);

  // PATCH /api/trips/{tripId}/status 호출 함수
  // mock GPS 좌표를 순서대로 전송
  // 백엔드가 좌표 기반으로 현재/다음 정류장, 남은 정류장 수, 하차벨 여부 계산해서 반환
  const patchStatus = async () => {
    const coord = MOCK_COORDINATES[mockCoordIndexRef.current];
    if (!coord) return;

    try {
      const res = await axios.patch(`${API_BASE_URL}/api/trips/${tripId}/status`, {
        requestId: `location-${mockCoordIndexRef.current + 1}`,
        latitude: coord.latitude,
        longitude: coord.longitude,
        recordedAt: new Date().toISOString(),
        source: 'MOCK',
      });

      setStatus(res.data);

      if (mockCoordIndexRef.current < MOCK_COORDINATES.length - 1) {
        mockCoordIndexRef.current += 1;
      }
    } catch (error) {
      console.log('위치 업데이트 실패:', error);
    }
  };

  // 하차 안내 화면으로 이동
  // bellRequestId, command, guideMessage를 AlightScreen에 전달
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

  // 시연용 버튼 함수
  // isBackendConnected = false일 때만 버튼 표시
  // isBackendConnected = true로 변경하면 버튼 자동으로 사라짐
  const goNextStation = () => {
    const nextIndex = mockIndex + 1;
    if (nextIndex < MOCK_STATUSES.length) {
      setMockIndex(nextIndex);
      setStatus(MOCK_STATUSES[nextIndex]);
    }
  };

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

      {/* 백엔드 연결 전까지만 표시되는 시연용 버튼 */}
      {!isBackendConnected && (
        <TouchableOpacity style={styles.button} onPress={goNextStation}>
          <Text style={styles.buttonText}>다음 정류장 이동 (시연용)</Text>
        </TouchableOpacity>
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
  button: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});