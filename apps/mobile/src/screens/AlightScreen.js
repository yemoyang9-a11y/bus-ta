import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { useRealtime } from '../realtime/RealtimeProvider';
import { connectBell, getBellDeviceName, isBellConnected, sendStopRequest, subscribeBellResult } from '../ble/bleManager';
import { TRIP_COMPLETION_MESSAGE } from '../realtime/trip-tracking';
import { createBellStopSession } from '../ble/bell-stop-session';

// 예모님 코멘트 5번(2026-08-13): 성공·실패·타임아웃을 화면·음성에서 구분해 안내한다.
const BELL_OUTCOME_TEXT = {
  waiting: '하차벨 응답을 기다리는 중...',
  success: '✅ 하차벨이 정상적으로 작동했습니다.',
  fail: '⚠️ 하차벨 응답을 받지 못했습니다. 기사님께 직접 말씀해주세요.',
};

const BELL_OUTCOME_TTS = {
  success: '하차벨이 정상적으로 작동했습니다.',
  fail: '하차벨 응답을 받지 못했습니다. 기사님께 직접 말씀해주세요.',
};

export default function AlightScreen({ route, navigation }) {
  // RidingScreen에서 전달받은 값들
  const { tripId, bellRequestId, command, guideMessage } = route.params;
  const resultSentRef = useRef(false); // 중복 전송 방지
  const { state, dispatch } = useTrip();
  const isFocused = useIsFocused();
  const { session, isConnected, trackingError } = useRealtime();
  const [homeError, setHomeError] = useState(null);
  const endingRef = useRef(false);
  const resultRetryTimerRef = useRef(null);
  const [bellOutcome, setBellOutcome] = useState('waiting'); // 'waiting' | 'success' | 'fail'

  const isMountedRef = useRef(false);
  const generationRef = useRef(0);
  const stopSessionRef = useRef(null);
  const latestRef = useRef(null);
  latestRef.current = { state, session, isConnected };

  useEffect(() => {
    if (!isFocused) return;
    if (state.journeyPhase === 'BUS_ALIGHT_CONFIRM' || (state.journeyRoute && !state.tripId)) navigation.navigate('Transfer');
    else if (!state.tripId) navigation.navigate('Main');
    if (trackingError) navigation.navigate('Error');
  }, [state.tripId, state.journeyRoute, state.journeyPhase, trackingError, isFocused]);

  useEffect(() => {
    if (state.tripStatus === 'TRIP_DONE') stopSessionRef.current?.flow.stopSending();
  }, [state.tripStatus]);

  useFocusEffect(
    React.useCallback(() => {
      if (latestRef.current.state.tripStatus === 'TRIP_DONE' || latestRef.current.state.tripStatus === 'CANCELLED') return;
      const generation = ++generationRef.current;
      const isCurrent = () => generationRef.current === generation && isMountedRef.current && latestRef.current.state.tripId === tripId && latestRef.current.state.tripStatus !== 'CANCELLED';
      isMountedRef.current = true;
      const key = JSON.stringify([tripId, bellRequestId]);
      if (stopSessionRef.current?.key !== key) {
        stopSessionRef.current?.flow.cancel();
        const { targetBeaconId, bleIsMock } = latestRef.current.state;
        stopSessionRef.current = {
          key,
          isMock: bleIsMock ?? true,
          flow: createBellStopSession({
            canSend: () => latestRef.current.state.tripId === tripId && !['TRIP_DONE', 'CANCELLED'].includes(latestRef.current.state.tripStatus),
            isConnected: () => targetBeaconId ? isBellConnected() : Promise.resolve(false),
            connect: () => targetBeaconId ? connectBell(targetBeaconId, tripId) : Promise.resolve(null),
            subscribeResult: subscribeBellResult,
            sendStopRequest,
          }),
        };
        resultSentRef.current = false;
        setBellOutcome('waiting');
      }
      const current = stopSessionRef.current;
      // 음성 완료를 기다리지 않고 전송 예산을 즉시 시작한다.
      if (!latestRef.current.isConnected && latestRef.current.state.tripStatus !== 'TRIP_DONE') {
        Speech.speak('하차벨을 요청했습니다. 안전하게 하차하세요.', { language: 'ko' });
      }
      current.flow.start().then(({ outcome, sendFailed, cancelled }) => {
        if (!isCurrent() || cancelled) return;
        void sendBellResult(outcome === 'success' ? 'SUCCESS' : 'FAIL', sendFailed ? true : current.isMock, isCurrent);
      });
      return () => {
        ++generationRef.current;
        isMountedRef.current = false;
        current.flow.cancel();
        if (latestRef.current.state.tripStatus !== 'TRIP_DONE') Speech.stop();
        if (resultRetryTimerRef.current) { clearTimeout(resultRetryTimerRef.current.timer); resultRetryTimerRef.current.resolve(); resultRetryTimerRef.current = null; }
      };
    }, [tripId, bellRequestId])
  );

  // 하차벨 결과 저장
  // 유나님 확인(2026-08-17): bell/result 저장 성공을 확인한 뒤에만 최신 상태를 조회해서
  // TripContext에 반영하고, Realtime 연결 중일 때만 notifyStatusChange를 호출한다.
  // 저장 실패 상태에서 AI가 성공을 안내하는 일이 없도록, 순서를 절대 바꾸지 않는다.
  const sendBellResult = async (result, isMock, isCurrent) => {
    if (resultSentRef.current) return; // 중복 전송 방지
    resultSentRef.current = true;
    const timestamp = new Date().toISOString();

    const resultMessage =
      result === 'SUCCESS'
        ? (isMock ? 'mock 하차벨 작동 성공' : '실제 하차벨(BLE) 작동 성공')
        : (isMock ? 'BLE 미연결 - 하차벨 미작동' : '실제 하차벨(BLE) 응답 없음');

    try {
      // 1. bell/result 저장
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (!isCurrent()) return;
        try {
          await apiClient.trips.bell.result(tripId, {
        bellRequestId,
        command,
        result,
        resultMessage,
        isMock,
        timestamp,
          });
          break;
        } catch (error) {
          if (!isCurrent()) return;
          if (attempt === 3 || (error instanceof ApiError && ['BELL_REQUEST_NOT_FOUND', 'INVALID_BELL_STATE'].includes(error.errorCode))) throw error;
          await new Promise(resolve => { resultRetryTimerRef.current = { resolve, timer: setTimeout(() => { resultRetryTimerRef.current = null; resolve(); }, attempt * 1000) }; });
        }
      }

      if (!isCurrent() || latestRef.current.state.tripStatus === 'TRIP_DONE') return;

      // 2. 저장 성공 확인 후에만 최신 상태 조회
      const latestStatus = await apiClient.trips.getStatus(tripId);

      if (!isCurrent() || latestRef.current.state.tripStatus === 'TRIP_DONE') return;

      // 3. TripContext에 최신 상태 반영
      dispatch({ type: 'UPDATE_TRIP_STATUS', status: latestStatus });

      if (['TRIP_DONE', 'CANCELLED'].includes(latestStatus.tripStatus)) return;
      // 재시도/충돌에서는 서버가 처음 저장한 결과가 물리 결과와 다를 수 있다.
      // 최신 조회로 확인한 최종 결과만 화면과 음성에 함께 사용한다.
      const confirmedOutcome = latestStatus.bellStatus === 'SUCCESS' ? 'success'
        : latestStatus.bellStatus === 'FAIL' ? 'fail' : null;
      if (!confirmedOutcome) return;
      setBellOutcome(confirmedOutcome);
      if (latestRef.current.isConnected) {
        // 4. Realtime 연결 중이면 세션에 알림 (성공/실패 여부와 무관하게, 확정된 결과만 전달)
        latestRef.current.session?.notifyStatusChange({
          tripStatus: latestStatus.tripStatus,
          remainingStations: latestStatus.remainingStations,
          currentStation: latestStatus.currentStation,
          bellStatus: latestStatus.bellStatus,
          guideMessage: latestStatus.guideMessage,
        });
      } else {
        // 5. Realtime 미연결일 때만 로컬 TTS로 확정된 결과 안내
        if (isMountedRef.current) {
          Speech.speak(BELL_OUTCOME_TTS[confirmedOutcome], { language: 'ko' });
        }
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.errorCode === 'BELL_REQUEST_NOT_FOUND') {
          console.log('하차벨 요청을 찾을 수 없습니다:', bellRequestId);
          return;
        }
        if (error.errorCode === 'INVALID_BELL_STATE') {
          console.log('이미 처리된 하차벨 요청입니다:', bellRequestId);
          return;
        }
      }
      // bell/result 저장 실패 — 성공으로 간주하지 않고 재시도 가능하도록 플래그만 되돌린다.
      // 이 경로에서는 notifyStatusChange, 성공 TTS 둘 다 호출하지 않는다.
      console.log('bell/result 저장 실패');
      if (isCurrent()) setHomeError('하차벨 결과 저장을 확인하지 못했습니다.');
      if (isCurrent()) resultSentRef.current = false;
    }
  };

  // 처음으로 돌아가기 — 다음 운행을 위해 공유 상태 초기화, BLE 연결 해제
  const handleGoHome = async () => {
    if (endingRef.current || latestRef.current.state.tripStatus === 'TRIP_DONE') return;
    endingRef.current = true;
    setHomeError(null);
    try {
      const result = await apiClient.trips.end(tripId, { action: 'CANCEL' });
      if (!result.success || latestRef.current.state.tripId !== tripId || latestRef.current.state.tripStatus === 'TRIP_DONE') return;
      ++generationRef.current;
      isMountedRef.current = false;
      stopSessionRef.current?.flow.cancel();
      dispatch({ type: 'RESET_TRIP' });
      navigation.navigate('Main');
    } catch {
      if (latestRef.current.state.tripId === tripId) setHomeError('운행 종료를 확인하지 못했습니다. 다시 시도해 주세요.');
    } finally { endingRef.current = false; }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <Text style={styles.title}>하차 안내</Text>

        <View style={styles.messageBox}>
          <Text style={styles.messageIcon}>⚠️</Text>
          <Text style={styles.message}>
            {state.tripStatus === 'TRIP_DONE' ? state.journeyRoute ? '이번 버스 구간에 도착했습니다. 실제로 내린 뒤 하차를 확인해 주세요.' : TRIP_COMPLETION_MESSAGE : '하차벨을 요청했습니다. 안전하게 하차하세요.'}
          </Text>
        </View>

        <View style={styles.infoBox}>
          {bellOutcome === 'waiting' && (
            <>
              <ActivityIndicator size="small" color="#2F8FFF" style={{ marginBottom: 8 }} />
              <Text style={styles.infoText}>{BELL_OUTCOME_TEXT.waiting}</Text>
            </>
          )}
          {bellOutcome !== 'waiting' && (
            <Text style={styles.infoText}>{BELL_OUTCOME_TEXT[bellOutcome]}</Text>
          )}
          <Text style={styles.infoSubText}>안전하게 하차 준비를 해주세요.</Text>
        </View>
      </View>

      {/* 처음으로 돌아가기 — 위 박스들과 간격을 두고 화면 아래쪽에 고정 */}
      <View style={styles.bottomSection}>
        {homeError && <Text accessibilityRole="alert" style={styles.infoText}>{homeError}</Text>}
        <TouchableOpacity
          style={styles.button}
          onPress={handleGoHome}
          disabled={state.tripStatus === 'TRIP_DONE'}
        >
          <Text style={styles.buttonIcon}>🏠</Text>
          <Text style={styles.buttonText}>처음으로 돌아가기</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: '#0A0C10',
    padding: 20,
    paddingTop: 40,
  },

  topSection: {},

  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFD400',
    marginBottom: 20,
  },

  // 경고 메시지 박스
  messageBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#15181F',
    borderWidth: 1,
    borderColor: '#2A2E37',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },

  messageIcon: {
    fontSize: 18,
    marginRight: 10,
  },

  message: {
    flex: 1,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // 하차벨 응답 대기/결과 박스 — 파란 테두리로 강조
  infoBox: {
    backgroundColor: '#15181F',
    borderWidth: 1.5,
    borderColor: '#2F8FFF',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },

  infoText: {
    fontSize: 17,
    color: '#FFFFFF',
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },

  infoSubText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },

  // 하단 액션 영역 — 위 박스들과 확실히 떨어지도록 별도 섹션으로 분리
  bottomSection: {
    width: '100%',
  },

  button: {
    flexDirection: 'row',
    backgroundColor: '#FFC400',
    minHeight: 76,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },

  buttonIcon: {
    fontSize: 18,
    marginRight: 8,
  },

  buttonText: {
    color: '#111111',
    fontSize: 20,
    fontWeight: '800',
  },
});
