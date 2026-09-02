import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useTrip } from '../state/TripContext';
import { getTripNavigationTarget } from '../state/trip-transition';

// Realtime 음성 세션의 실제 진입점.
// 목적지 인식과 확인은 구식 STT/Confirm 화면이 아니라 Realtime 대화 안에서 처리한다.
export default function MainScreen({ navigation }) {
  const { connect, connectionStatus, connectionError } = useRealtime();
  const { state } = useTrip();
  const { destination, routeCandidates, selectedRoute, tripId } = state;

  useEffect(() => {
    connect().catch(() => {
      // 실패 내용은 Provider 상태를 통해 화면에 표시한다.
    });
  }, []);

  // Function 결과는 TripContext에 저장된다. 이 화면은 그 단일 상태를 보고 이동한다.
  useEffect(() => {
    const target = getTripNavigationTarget({ tripId, routeCandidates });

    if (target === 'Riding') {
      navigation.navigate('Riding', { tripId, selectedRoute });
      return;
    }

    if (target === 'RouteList') {
      navigation.navigate('RouteList');
    }
  }, [tripId, routeCandidates, navigation, selectedRoute]);

  const handleRetry = () => {
    connect().catch(() => {});
  };

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
      <View>
        <Text style={styles.title}>버스 도우미</Text>
        <Text style={styles.subtitle}>시각장애인 대중교통 보조 앱</Text>
      </View>

      <View style={styles.statusBox}>
        <StatusRow
          icon="📶"
          label="연결 상태"
          value={connectionStatusLabel(connectionStatus)}
          isConnected={connectionStatus === 'connected'}
        />
        <StatusRow
          icon="📍"
          label="목적지"
          value={destination ?? '아직 없음'}
          highlight
        />
        <StatusRow
          icon="📋"
          label="현재 단계"
          value={getStatusText()}
        />
      </View>

      {connectionStatus === 'error' && (
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>다시 연결하기</Text>
        </TouchableOpacity>
      )}

      {connectionStatus === 'connected' && <Text style={styles.hint}>🎤 말씀해주세요</Text>}
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

// icon: 라벨 앞에 붙는 장식용 아이콘 문자
// isConnected가 주어진 행에만 상태 배지(초록/빨강 점 + 라벨 옆 뱃지)가 붙는다
// highlight가 true인 행(목적지)은 파란 테두리로 강조된다
function StatusRow({ icon, label, value, isConnected, highlight }) {
  const showBadge = isConnected !== undefined;

  return (
    <View style={[styles.statusRow, highlight && styles.statusRowHighlight]}>
      <View style={styles.statusLabelRow}>
        <View style={styles.statusLabelWithIcon}>
          {icon && <Text style={styles.statusIcon}>{icon}</Text>}
          <Text style={styles.statusLabel}>{label}</Text>
        </View>

        {showBadge && (
          <View
            style={[
              styles.connectionBadge,
              { borderColor: isConnected ? '#2ECC71' : '#E74C3C' },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#2ECC71' : '#E74C3C' },
              ]}
              accessibilityElementsHidden={true}
              importantForAccessibility="no-hide-descendants"
            />
            <Text
              style={[
                styles.connectionBadgeText,
                { color: isConnected ? '#2ECC71' : '#E74C3C' },
              ]}
            >
              {value}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.statusValue}>{value}</Text>
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
    borderBottomWidth: 1,
    borderBottomColor: '#2A2E37',
  },

  statusBox: {
    width: '100%',
    backgroundColor: 'transparent',
  },

  statusRow: {
    width: '100%',
    backgroundColor: '#15181F',
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#2A2E37',
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginBottom: 14,
  },

  // 목적지 카드 — 파란 실선 테두리로 강조
  statusRowHighlight: {
    borderColor: '#2F8FFF',
    borderWidth: 1.5,
  },

  statusLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  statusLabelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  statusIcon: {
    fontSize: 15,
    marginRight: 6,
  },

  statusLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#9CA3AF',
  },

  // 연결 상태 배지 — 초록/빨강 테두리의 캡슐형 뱃지
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },

  connectionBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },

  statusValue: {
    fontSize: 24,
    lineHeight: 32,
    color: '#FFFFFF',
    fontWeight: '800',
  },

  retryButton: {
    width: '100%',
    minHeight: 76,
    backgroundColor: '#FFC400',
    borderRadius: 22,
    borderWidth: 3,
    borderStyle: 'solid',
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  retryButtonText: {
    color: '#111111',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },

  hint: {
    width: '100%',
    minHeight: 84,
    backgroundColor: '#FFC400',
    color: '#111111',
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderRadius: 22,
    borderWidth: 3,
    borderStyle: 'solid',
    borderColor: '#FFFFFF',
  },
});
