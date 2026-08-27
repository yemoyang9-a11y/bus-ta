import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useTrip } from '../state/TripContext';
import { useMainScreenPermissions } from '../hooks/useMainScreenPermissions';
import { useAutoRetry } from '../hooks/useAutoRetry';

// 메인 화면 — Realtime 음성 세션의 실제 진입점 (2026-08-15, 예모님 확정 구조)
// 구식 STTScreen/ConfirmScreen 흐름은 삭제됨. 목적지 인식·확인은 Realtime 대화 안에서 처리한다.
// 이 화면의 텍스트 표시는 음성 흐름을 막는 "필수 확인 단계"가 아니라,
// 저시력 사용자·보호자·테스트 담당자를 위한 보조 정보다.
//
// 유나님 확인(2026-08-15): expo-speech(스피커)와 Realtime 마이크가 동시에 켜져 있으면,
// 스피커 음성을 마이크가 사용자 발화로 재입력해서 AI 응답이 반복·끊기는 원인이 된다.
// Realtime 연결 중에는 expo-speech를 전혀 사용하지 않고, "목적지를 말씀해주세요" 안내도
// Realtime 모델이 세션 시작 시 한 번만 말하도록 session.ts/guide.ts 쪽에서 처리한다.
// 이 화면은 연결 실패 시 안내(재시도 문구)에만 expo-speech를 사용한다 — 그때는 마이크가 꺼져 있어 안전하다.
export default function MainScreen({ navigation }) {
  const { connect, connectionStatus, connectionError } = useRealtime();
  const { state } = useTrip();
  const { destination, routeCandidates, selectedRoute, tripId } = state;

  const { permissionsGranted, permissionError, checkPermissions } = useMainScreenPermissions();

  const attemptConnect = useCallback(async () => {
    const granted = await checkPermissions();
    if (!granted) return;
    await connect();
  }, [checkPermissions, connect]);

  useEffect(() => {
    attemptConnect().catch(() => {
      // 실패 시 connectionStatus가 'error'로 바뀌므로 화면에서 안내 문구로 처리
    });
  }, [attemptConnect]);

  // 연결 실패 시 자동 재시도
  const { isRetrying, retryDelayMs } = useAutoRetry({
    shouldRetry: connectionStatus === 'error',
    onRetry: attemptConnect,
  });

  // function-dispatcher.ts는 React 컴포넌트가 아니라 navigation을 직접 호출할 수 없다.
  // 대신 TripContext(단일 원본)를 업데이트하고, MainScreen이 그 변화를 감지해서 화면을 전환한다.
  // (2026-08-15, 방법 1 채택)
  // 채린님 확인(2026-08-15): 목적지가 채워지자마자 즉시 화면이 넘어가서, 사용자가 인식된
  // 목적지 텍스트를 볼 시간이 없었다. 노선 목록으로 넘어가기 전 잠시 머무르게 지연을 준다.
  useEffect(() => {
    if (tripId) {
      navigation.replace('Riding', { tripId, selectedRoute });
      return;
    }
    if (routeCandidates && routeCandidates.length > 0) {
      const timer = setTimeout(() => {
        navigation.replace('RouteList');
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [tripId, routeCandidates, navigation, selectedRoute]);

  const handleRetry = () => {
    Speech.speak('다시 연결을 시도합니다.', { language: 'ko' });
    attemptConnect().catch(() => {});
  };

  // 현재 진행 단계를 하나의 문장으로 표현 (보조 표시용)
  const getStatusText = () => {
    if (!permissionsGranted) return permissionError ?? '권한을 확인하는 중...';
    if (connectionStatus === 'connecting') return '음성 연결 중...';
    if (connectionStatus === 'error') {
      if (isRetrying) return `연결 재시도 중... (${Math.round(retryDelayMs / 1000)}초 후)`;
      return `연결 실패: ${connectionError ?? '알 수 없는 오류'}`;
    }
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
        <StatusRow
          label="연결 상태"
          value={connectionStatusLabel(connectionStatus)}
          isConnected={connectionStatus === 'connected'}
        />
        <StatusRow label="목적지" value={destination ?? '아직 없음'} highlight />
        <StatusRow label="현재 단계" value={getStatusText()} />
      </View>

      {connectionStatus === 'error' && !isRetrying && (
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

function StatusRow({ label, value, isConnected, highlight }) {
  const showDot = isConnected !== undefined;

  return (
    <View style={[styles.statusRow, highlight && styles.statusRowHighlight]}>
      <View style={styles.statusLabelRow}>
        <Text style={[styles.statusLabel, highlight && styles.statusLabelOnHighlight]}>
          {label}
        </Text>
        {showDot && (
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isConnected ? '#2ECC71' : '#E74C3C' },
            ]}
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
          />
        )}
      </View>
      <Text style={[styles.statusValue, highlight && styles.statusValueOnHighlight]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: '#F5F7FA',
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111111',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 28,
  },
  statusBox: {
    width: '100%',
    backgroundColor: 'transparent',
    marginBottom: 28,
  },
  statusRow: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: '#B8C2D0',
    paddingVertical: 22,
    paddingHorizontal: 22,
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  statusRowHighlight: {
    backgroundColor: '#1E4FD8',
    borderColor: '#0F2E8C',
    shadowOpacity: 0.15,
  },
  statusLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
  },
  statusLabelOnHighlight: {
    color: '#DCE6FF',
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#00000030',
  },
  statusValue: {
    fontSize: 28,
    lineHeight: 36,
    color: '#000000',
    fontWeight: '800',
  },
  statusValueOnHighlight: {
    color: '#FFFFFF',
  },
  retryButton: {
    width: '100%',
    minHeight: 76,
    backgroundColor: '#1E4FD8',
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 4,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  hint: {
    width: '100%',
    backgroundColor: '#1E4FD8',
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '800',
    textAlign: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 18,
    marginTop: 4,
  }
});