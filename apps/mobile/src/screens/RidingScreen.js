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
  // 같은 상태 변화를 Realtime(session.ts)이 이미 음성으로 안내하기 때문이다.
  useEffect(() => {
    if (isConnected) return;
    if (status.guideMessage && status.remainingStations !== 1) {
      const timer = setTimeout(() => {
        Speech.speak(status.guideMessage, { language: 'ko' });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [status.guideMessage, status.remainingStations, isConnected]);

  // 정민님 확인(2026-08-12): 탑승 완료(WAITING_BUS → ON_BUS 전환) 시 비콘 스캔 중지
  // "탑승하면 버스 찾는 진동이 필요 없으니까" — 하차벨 STOP_REQUEST와는 별개
  //
  // 예모님 코멘트 P0-2(2026-08-14): 이전에는 시도 여부만 기록해서 stopBeaconScan()이
  // 실패해도 "처리 완료"로 간주되고 재시도가 없었다. 이제 TripContext의
  // beaconScanActive(RouteListScreen이 스캔 시작 성공 시에만 true로 세팅)를 확인해서,
  // 스캔이 실제로 켜져 있고 아직 안 껐을 때만 시도하고, 성공했을 때만 false로 바꾼다.
  // 실패하면 beaconScanActive가 true로 남아있어 다음 GPS 주기(3초 후)에 다시 시도된다.
  useEffect(() => {
    if (
      status.tripStatus === 'ON_BUS' &&
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
  }, [status.tripStatus, state.beaconScanActive]);

  // 1정거장 남았을 때 TTS 출력 후 하차 안내 화면 전환
  // API_SPEC.md 기준:
  // - bellRequestId는 백엔드가 PATCH /status 응답에서 생성한 값 (프론트 생성 금지)
  // - shouldTriggerBell: true + bellStatus: PENDING + bellRequestId 존재 시 실행
  // 유나님 확인(2026-08-15): 이 화면 전환 트리거는 유지하되, TTS 자체는
  // Realtime 연결 중이면 재생하지 않는다 (session.ts가 하차 1정거장 전 안내를 우선 보존해서 처리).
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
        // 유나님 확인(2026-08-15): 이전 PATCH가 아직 진행 중이면 이번 주기는 건너뛴다.
        // 겹쳐서 호출되면 요청 순서가 뒤섞이거나 상태가 중복 반영될 수 있다.
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
  // requestId는 앱이 생성하는 멱등 키 — 같은 좌표 재전송 시에는 재사용하지 않고 매 전송마다 새로 발급한다
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
      // dispatch는 비동기라, TripContext를 다시 읽지 않고 방금 받은 data를 직접 넘긴다.
      // (예모님 코멘트 2번, 2026-08-13 반영)
      session?.notifyStatusChange({
        tripStatus: data.tripStatus,
        remainingStations: data.remainingStations,
        currentStation: data.currentStation,
        bellStatus: data.bellStatus,
        guideMessage: data.guideMessage,
      });

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
            session?.notifyStatusChange({
              tripStatus: latest.tripStatus,
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
      // 네트워크 실패 등은 다음 주기에 재시도 (requestId는 다음 좌표에 새로 발급되므로 중복 걱정 없음)
      console.log('위치 업데이트 실패:', error);
    } finally {
      patchInFlightRef.current = false;
    }
  };

  // 하차 안내 화면으로 이동
  // 예모님 코멘트 P1-2(2026-08-14): navigate()는 이전 화면을 언마운트하지 않아
  // GPS 폴링(setInterval)과 TTS가 계속 실행될 수 있다. 화면 전환 직전에 명시적으로 멈춘다.
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

  if (!status.currentStation || !status.nextStation) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>탑승 중</Text>
        <View
          style={styles.guideBox}
          accessible={true}
          accessibilityLabel={status.guideMessage}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.guideText}>{status.guideMessage}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>탑승 중</Text>

      <View
        style={styles.infoBox}
        accessible={true}
        accessibilityLabel={`현재 정류장: ${status.currentStation.stationName}`}
      >
        <Text style={styles.label}>현재 정류장</Text>
        <Text style={styles.stationName}>{status.currentStation.stationName}</Text>
      </View>

      <View
        style={styles.infoBox}
        accessible={true}
        accessibilityLabel={`다음 정류장: ${status.nextStation.stationName}`}
      >
        <Text style={styles.label}>다음 정류장</Text>
        <Text style={styles.stationName}>{status.nextStation.stationName}</Text>
      </View>

      {/* 남은 정류장 — 이 화면의 히어로 정보, 파란 카드로 강조 */}
      <View
        style={styles.remainBox}
        accessible={true}
        accessibilityLabel={`남은 정류장 ${status.remainingStations}개`}
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.remainText}>남은 정류장</Text>
        <Text style={styles.remainCount}>{status.remainingStations}</Text>
      </View>

      <View
        style={styles.guideBox}
        accessible={true}
        accessibilityLabel={status.guideMessage}
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.guideText}>{status.guideMessage}</Text>
      </View>

      {status.remainingStations === 2 && (
        <View
          style={styles.prepareBox}
          accessible={true}
          accessibilityLabel="곧 하차를 준비하세요"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.prepareText}>⚠️ 곧 하차 준비하세요</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
    padding: 20,
  },

  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111111',
    marginBottom: 24,
    textAlign: 'center',
  },

  // 현재/다음 정류장 — 흰 카드, 두꺼운 테두리
  infoBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    borderColor: '#B8C2D0',
    padding: 20,
    borderRadius: 18,
    marginBottom: 14,
  },

  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
  },

  stationName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111111',
  },

  // 남은 정류장 — 이 화면의 히어로 카드, 파란 배경으로 강조
  remainBox: {
    backgroundColor: '#1E4FD8',
    borderWidth: 2.5,
    borderColor: '#0F2E8C',
    padding: 20,
    borderRadius: 18,
    marginBottom: 14,
    alignItems: 'center',
  },

  remainText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#DCE6FF',
    marginBottom: 6,
  },

  remainCount: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // 안내 메시지 — 노란 배경 대신, 팔레트 안의 밝은 회색 카드 + 진한 테두리로 대체
  // (색상 종류를 늘리지 않기 위해 경고색은 prepareBox에만 사용)
  guideBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    borderColor: '#B8C2D0',
    padding: 20,
    borderRadius: 18,
    marginBottom: 14,
  },

  guideText: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    color: '#111111',
  },

  // 하차 준비 경고 — 이 화면에서 유일하게 허용하는 별도 경고색 (주황)
  // 색맹 고려: 색만이 아니라 ⚠️ 아이콘 + 굵은 텍스트로 이중 신호
  prepareBox: {
    backgroundColor: '#FFF4E5',
    borderWidth: 2.5,
    borderColor: '#E65100',
    padding: 18,
    borderRadius: 18,
    marginBottom: 14,
    alignItems: 'center',
  },

  prepareText: {
    fontSize: 20,
    color: '#E65100',
    fontWeight: '800',
  },
});