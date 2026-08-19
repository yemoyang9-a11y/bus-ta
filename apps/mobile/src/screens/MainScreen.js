import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useTrip } from '../state/TripContext';

// 메인 화면 — Realtime 음성 세션의 실제 진입점 (2026-08-15, 예모님 확정 구조)
// 구식 STTScreen/ConfirmScreen 흐름은 삭제됨. 목적지 인식·확인은 Realtime 대화 안에서 처리한다.
// 이 화면의 텍스트 표시는 음성 흐름을 막는 "필수 확인 단계"가 아니라,
// 저시력 사용자·보호자·테스트 담당자를 위한 보조 정보다.
export default function MainScreen({ navigation }) {
  const { connect, connectionStatus, connectionError } = useRealtime();
  const { state } = useTrip();
  const { destination, routeCandidates, selectedRoute, tripId } = state;

  // 채린님 확인(2026-08-15): 연결 시도와 "목적지를 말씀해주세요" 안내가 동시에 시작돼서,
  // 실제로는 아직 연결이 안 된 상태에서 안내만 먼저 끝나버리는 문제 발견.
  // connectionStatus가 'connected'로 바뀌는 순간에만 안내 음성이 나오도록 변경.
  const hasAnnouncedReadyRef = useRef(false);

  useEffect(() => {
    connect().catch(() => {
      // 실패 시 connectionStatus가 'error'로 바뀌므로 화면에서 안내 문구로 처리
    });
  }, []);

  useEffect(() => {
    if (connectionStatus === 'connected' && !hasAnnouncedReadyRef.current) {
      hasAnnouncedReadyRef.current = true;
      Speech.speak('버스 도우미를 시작합니다. 목적지를 말씀해주세요.', { language: 'ko' });
    }
  }, [connectionStatus]);

  // function-dispatcher.ts는 React 컴포넌트가 아니라 navigation을 직접 호출할 수 없다.
  // 대신 TripContext(단일 원본)를 업데이트하고, MainScreen이 그 변화를 감지해서 화면을 전환한다.
  // (2026-08-15, 방법 1 채택)
  useEffect(() => {
    console.log('[Debug] tripId:', tripId, '/ routeCandidates:', JSON.stringify(routeCandidates));
    if (tripId) {
      console.log('[Debug] navigate to Riding');
      navigation.navigate('Riding', { tripId, selectedRoute });
      return;
    }
    if (routeCandidates && routeCandidates.length > 0) {
      console.log('[Debug] navigate to RouteList');
      navigation.navigate('RouteList');
    }
  }, [tripId, routeCandidates]);

  const handleRetry = () => {
    hasAnnouncedReadyRef.current = false;
    Speech.speak('다시 연결을 시도합니다.', { language: 'ko' });
    connect().catch(() => {});
  };

  // 현재 진행 단계를 하나의 문장으로 표현 (보조 표시용)
  const getStatusText = () => {
    if (connectionStatus === 'connecting') return '음성 연결 중...';
    if (connectionStatus === 'error') return `연결 실패: ${connectionError ?? '알 수 없는 오류'}`;
    if (connectionStatus !== 'connected') return '연결 대기 중';

    if (tripId) return '운행 안내 중';
    if (selectedRoute) return '노선을 확인하는 중...';
    if (routeCandidates && routeCandidates.length > 0) return '노선을 선택해주세요';
    if (destination) return `"${destination}" 경로를 검색하는 중...`;
    return '목적지를 말씀해주세요';
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>버스 도우미</Text>
      <Text style={styles.subtitle}>시각장애인 대중교통 보조 앱</Text>

      {/* 보조 정보 — 필수 확인 단계 아님, 저시력 사용자·보호자·테스트 담당자용 */}
      <View style={styles.statusBox}>
        <StatusRow label="연결 상태" value={connectionStatusLabel(connectionStatus)} />
        <StatusRow label="목적지" value={destination ?? '아직 없음'} />
        <StatusRow label="현재 단계" value={getStatusText()} />
      </View>

      {connectionStatus === 'error' && (
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>다시 연결하기</Text>
        </TouchableOpacity>
      )}

      {connectionStatus === 'connected' && (
        <Text style={styles.hint}>🎤 말씀해주세요</Text>
      )}
    </View>
  );
}

function connectionStatusLabel(status) {
  switch (status) {
    case 'connecting':
      return '연결 중...';
    case 'connected':
      return '연결됨';
    case 'error':
      return '연결 실패';
    default:
      return '대기 중';
  }
}

function StatusRow({ label, value }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: '#0B1B34',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 40,
  },

  topSection: {},

  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 28,
  },

  // 목적지 — 화면에서 가장 눈에 띄는 요소
  destinationHero: {
    alignItems: 'center',
    marginBottom: 36,
  },

  destinationLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#8FA3C4',
    marginBottom: 10,
  },

  destinationValue: {
    fontSize: 40, // 가장 큰 텍스트 — 목적지가 화면의 주인공
    lineHeight: 48,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  // 보조 정보 박스 — 상대적으로 작고 눈에 덜 띄게
  statusBox: {
    width: '100%',
    backgroundColor: '#132743',
    borderWidth: 2,
    borderColor: '#2E4A73',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 12,
  },

  statusRow: {
    width: '100%',
    marginBottom: 14,
  },

  statusLabelWithDot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },

  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8FA3C4',
    marginBottom: 4,
  },

  statusValue: {
    fontSize: 16, // 이전보다 작게 — 보조 정보로 위계 낮춤
    lineHeight: 22,
    color: '#D6DEEB',
    fontWeight: '600',
  },

  retryButton: {
    width: '100%',
    minHeight: 76,
    backgroundColor: '#2F6FED',
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },

  hint: {
    width: '100%',
    minHeight: 84,
    backgroundColor: '#2F6FED',
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 24,
    borderRadius: 18,
    justifyContent: 'center',
  },
});