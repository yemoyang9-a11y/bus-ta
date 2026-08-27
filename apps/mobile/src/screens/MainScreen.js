import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useTrip } from '../state/TripContext';

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

  useEffect(() => {
    connect().catch(() => {
      // 실패 시 connectionStatus가 'error'로 바뀌므로 화면에서 안내 문구로 처리
    });
  }, []);

  // function-dispatcher.ts는 React 컴포넌트가 아니라 navigation을 직접 호출할 수 없다.
  // 대신 TripContext(단일 원본)를 업데이트하고, MainScreen이 그 변화를 감지해서 화면을 전환한다.
  // (2026-08-15, 방법 1 채택)
  // 채린님 확인(2026-08-15): 목적지가 채워지자마자 즉시 화면이 넘어가서, 사용자가 인식된
  // 목적지 텍스트를 볼 시간이 없었다. 노선 목록으로 넘어가기 전 2초 정도 머무르게 지연을 준다.
  useEffect(() => {
    if (tripId) {
      navigation.navigate('Riding', { tripId, selectedRoute });
      return;
    }
    if (routeCandidates && routeCandidates.length > 0) {
      const timer = setTimeout(() => {
        navigation.navigate('RouteList');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [tripId, routeCandidates]);

  // 연결 실패 시에만 사용 — 이 시점엔 마이크가 열려 있지 않아 expo-speech가 안전하다.
  const handleRetry = () => {
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
      <Text style={styles.subtitle}>시각장애인 대중교통 이용 보조 시스템</Text>

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
    backgroundColor: '#0A0C10',
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 32,
  },

  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFD400',
    textAlign: 'left',
    marginBottom: 4,
  },

  subtitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#8A8F98',
    textAlign: 'left',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1, // 시안의 서브타이틀 아래 얇은 구분선
    borderBottomColor: '#2A2E37',
  },

  statusBox: {
    width: '100%',
    backgroundColor: 'transparent',
    marginBottom: 28,
  },

  statusRow: {
    width: '100%',
    backgroundColor: '#15181F',
    borderRadius: 18,
    borderWidth: 1, // 점선 → 얇은 실선
    borderStyle: 'solid',
    borderColor: '#2A2E37',
    paddingVertical: 22,
    paddingHorizontal: 22,
    marginBottom: 14,
  },

  // 목적지 카드 — 얇은 실선이지만 블루로 강조
  statusRowHighlight: {
    backgroundColor: '#15181F',
    borderStyle: 'solid',
    borderColor: '#2F8FFF',
    borderWidth: 1.5,
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
    color: '#9CA3AF',
  },

  statusLabelOnHighlight: {
    color: '#93B4FF',
  },

  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#00000060',
  },

  statusValue: {
    fontSize: 28,
    lineHeight: 36,
    color: '#FFD400',
    fontWeight: '800',
  },

  statusValueOnHighlight: {
    color: '#FFD400',
  },

  retryButton: {
    width: '100%',
    minHeight: 76,
    backgroundColor: '#FFC400',
    borderRadius: 22,
    borderWidth: 3, // 시안처럼 두꺼운 흰 테두리
    borderStyle: 'solid',
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 4,
  },

  retryButtonText: {
    color: '#111111',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },

  hint: {
    width: '100%',
    backgroundColor: '#FFC400',
    color: '#111111',
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '800',
    textAlign: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 22,
    borderWidth: 3,
    borderStyle: 'solid',
    borderColor: '#FFFFFF',
    marginTop: 4,
  }
});