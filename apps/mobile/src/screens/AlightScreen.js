import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { useRealtime } from '../realtime/RealtimeProvider';
import { sendStopRequest, subscribeBellResult, disconnect } from '../ble/bleManager';

// 정민님 확인(2026-08-12): 하차벨 응답을 못 받을 경우를 대비한 대기 시간
const BELL_RESULT_TIMEOUT_MS = 10000;

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
  const { session, isConnected } = useRealtime();
  const [bellOutcome, setBellOutcome] = useState('waiting'); // 'waiting' | 'success' | 'fail'

  const unsubscribeRef = useRef(() => {});
  const timeoutIdRef = useRef(null);
  const isMountedRef = useRef(true);

  useFocusEffect(
    React.useCallback(() => {
      isMountedRef.current = true;

      // 유나님 확인(2026-08-17): Realtime 연결 중에는 로컬 TTS를 생략하고 바로 BLE 처리로 넘어간다.
      // Realtime 미연결일 때만 기존 고정 TTS로 대체 안내한다.
      if (isConnected) {
        requestActualBellStop();
        return () => {
          isMountedRef.current = false;
          if (timeoutIdRef.current) {
            clearTimeout(timeoutIdRef.current);
            timeoutIdRef.current = null;
          }
          unsubscribeRef.current();
        };
      }

      const timer = setTimeout(() => {
        const ttsMessage = '하차벨을 요청했습니다. 안전하게 하차하세요.';
        Speech.speak(ttsMessage, {
          language: 'ko',
          onDone: () => {
            requestActualBellStop();
          },
        });
      }, 500);

      return () => {
        clearTimeout(timer);
        Speech.stop();
        isMountedRef.current = false;
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
        unsubscribeRef.current();
      };
    }, [isConnected])
  );

  // 결과를 확정하고, 화면·음성 안내를 결과에 맞게 갱신한 뒤 서버에 전송한다.
  const finalizeBellOutcome = (outcome, isMock) => {
    if (!isMountedRef.current) return;
    setBellOutcome(outcome);
    sendBellResult(outcome === 'success' ? 'SUCCESS' : 'FAIL', isMock);
  };

  const requestActualBellStop = () => {
    const isMock = state.bleIsMock ?? true;

    const handleBellResult = (result) => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      unsubscribeRef.current();
      finalizeBellOutcome(result.result === 'SUCCESS' ? 'success' : 'fail', isMock);
    };

    try {
      unsubscribeRef.current = subscribeBellResult(handleBellResult);

      sendStopRequest().catch((error) => {
        console.log('하차벨 명령 전송 실패:', error);
      });

      timeoutIdRef.current = setTimeout(() => {
        unsubscribeRef.current();
        finalizeBellOutcome('fail', isMock);
      }, BELL_RESULT_TIMEOUT_MS);
    } catch (error) {
      console.log('하차벨 BLE 연결 실패:', error);
      finalizeBellOutcome('fail', true);
    }
  };

  // 하차벨 결과 저장
  // 유나님 확인(2026-08-17): bell/result 저장 성공을 확인한 뒤에만 최신 상태를 조회해서
  // TripContext에 반영하고, Realtime 연결 중일 때만 notifyStatusChange를 호출한다.
  // 저장 실패 상태에서 AI가 성공을 안내하는 일이 없도록, 순서를 절대 바꾸지 않는다.
  const sendBellResult = async (result, isMock) => {
    if (resultSentRef.current) return; // 중복 전송 방지
    resultSentRef.current = true;

    const resultMessage =
      result === 'SUCCESS'
        ? (isMock ? 'mock 하차벨 작동 성공' : '실제 하차벨(BLE) 작동 성공')
        : (isMock ? 'BLE 미연결 - 하차벨 미작동' : '실제 하차벨(BLE) 응답 없음');

    try {
      // 1. bell/result 저장
      await apiClient.trips.bell.result(tripId, {
        bellRequestId,
        command,
        result,
        resultMessage,
        isMock,
        timestamp: new Date().toISOString(),
      });

      // 2. 저장 성공 확인 후에만 최신 상태 조회
      const latestStatus = await apiClient.trips.getStatus(tripId);

      // 3. TripContext에 최신 상태 반영
      dispatch({ type: 'UPDATE_TRIP_STATUS', status: latestStatus });

      if (isConnected) {
        // 4. Realtime 연결 중이면 세션에 알림 (성공/실패 여부와 무관하게, 확정된 결과만 전달)
        session?.notifyStatusChange({
          tripStatus: latestStatus.tripStatus,
          remainingStations: latestStatus.remainingStations,
          currentStation: latestStatus.currentStation,
          bellStatus: latestStatus.bellStatus,
          guideMessage: latestStatus.guideMessage,
        });
      } else {
        // 5. Realtime 미연결일 때만 로컬 TTS로 확정된 결과 안내
        if (isMountedRef.current) {
          Speech.speak(BELL_OUTCOME_TTS[result === 'SUCCESS' ? 'success' : 'fail'], { language: 'ko' });
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
      console.log('bell/result 전송 실패:', error);
      resultSentRef.current = false;
    }
  };

  // 처음으로 돌아가기 — 다음 운행을 위해 공유 상태 초기화, BLE 연결 해제
  const handleGoHome = () => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    unsubscribeRef.current();
    disconnect('White_cane').catch(() => {});
    disconnect('BUS_1551_001').catch(() => {});
    dispatch({ type: 'RESET_TRIP' });
    navigation.navigate('Main');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🚨</Text>
      <Text style={styles.title}>하차 안내</Text>
      <Text style={styles.message}>
        하차벨을 요청했습니다. 안전하게 하차하세요.
      </Text>

      <View style={styles.infoBox}>
        {bellOutcome === 'waiting' && (
          <>
            <ActivityIndicator size="small" color="#fff" style={{ marginBottom: 8 }} />
            <Text style={styles.infoText}>{BELL_OUTCOME_TEXT.waiting}</Text>
          </>
        )}
        {bellOutcome !== 'waiting' && (
          <Text style={styles.infoText}>{BELL_OUTCOME_TEXT[bellOutcome]}</Text>
        )}
        <Text style={styles.infoSubText}>안전하게 하차 준비를 해주세요.</Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={handleGoHome}
      >
        <Text style={styles.buttonText}>처음으로 돌아가기</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FF5252',
    padding: 20,
  },
  emoji: {
    fontSize: 80,
    marginBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  message: {
    fontSize: 22,
    color: '#fff',
    marginBottom: 30,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 40,
    width: '100%',
  },
  infoText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  infoSubText: {
    fontSize: 14,
    color: '#fff',
  },
  button: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    width: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FF5252',
    fontSize: 16,
    fontWeight: 'bold',
  },
});