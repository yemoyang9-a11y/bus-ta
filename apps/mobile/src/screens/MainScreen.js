import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useTrip } from '../state/TripContext';

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
    if (tripId) {
      navigation.navigate('Riding', { tripId, selectedRoute });
      return;
    }
    if (routeCandidates && routeCandidates.length > 0) {
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
        <StatusRow label="연결 상태" value={connectionStatusLabel(connectionStatus)} />
        <StatusRow label="목적지" value={destination ?? '아직 없음'} />
        <StatusRow label="현재 단계" value={getStatusText()} />
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
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8FA3C4',
    textAlign: 'center',
  },
  statusBox: {
    width: '100%',
    backgroundColor: '#132743',
    borderWidth: 2,
    borderColor: '#2E4A73',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  statusRow: {
    width: '100%',
    marginBottom: 14,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8FA3C4',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 16,
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
    paddingVertical: 24,
    borderRadius: 18,
  },
});
