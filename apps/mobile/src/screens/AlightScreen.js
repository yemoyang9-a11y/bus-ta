import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
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
  // - tripId: 운행 ID
  // - bellRequestId: 백엔드가 PATCH /status에서 생성한 하차벨 요청 ID
  // - command: 백엔드가 반환한 STOP_REQUEST 값
  // - guideMessage: 백엔드 안내 문장 (유나 AI 모듈 생성, 탑승 중 화면용 문장)
  const { tripId, bellRequestId, command, guideMessage } = route.params;
  const resultSentRef = useRef(false); // 중복 전송 방지
  const { state, dispatch } = useTrip();
  const [bellOutcome, setBellOutcome] = useState('waiting'); // 'waiting' | 'success' | 'fail'

  // 예모님 코멘트 6번(2026-08-13): 화면을 벗어나도 타이머·구독이 남아있어
  // 뒤늦게 FAIL이 전송되는 문제 방지 — ref로 관리해서 언마운트 시 정리한다.
  const unsubscribeRef = useRef(() => {});
  const timeoutIdRef = useRef(null);
  const isMountedRef = useRef(true);

  useFocusEffect(
    React.useCallback(() => {
      isMountedRef.current = true;

      const timer = setTimeout(() => {
        // 하차 안내 화면 전용 TTS 문장 (탑승 중 화면과 중복되지 않도록 별도 문장 사용)
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

        // 화면을 벗어나면 타이머·구독 정리, 이후 콜백이 상태를 건드리지 않도록 표시
        isMountedRef.current = false;
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
        unsubscribeRef.current();
      };
    }, [])
  );

  // 결과를 확정하고, 화면·음성 안내를 결과에 맞게 갱신한 뒤 서버에 전송한다.
  const finalizeBellOutcome = (outcome, isMock) => {
    if (!isMountedRef.current) return;
    setBellOutcome(outcome);
    Speech.speak(BELL_OUTCOME_TTS[outcome], { language: 'ko' });
    sendBellResult(outcome === 'success' ? 'SUCCESS' : 'FAIL', isMock);
  };

  // 실제 하차벨(BLE)에 STOP_REQUEST를 전송하고, 결과(Notify)를 구독해서 받는다.
  // (2026-08-12, GitHub 리뷰 2번 반영: mock 고정값 대신 실제 BLE 결과 사용)
  const requestActualBellStop = () => {
    // 예모님 코멘트 2번(2026-08-13): RouteListScreen이 저장해 둔 실제 isMock 값을 사용한다.
    // BLE 교신이 0회였는데도 isMock: false로 기록되던 문제를 막는다.
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

      // 결과를 기다리는 동안 명령 전송
      sendStopRequest().catch((error) => {
        console.log('하차벨 명령 전송 실패:', error);
      });

      // 정해진 시간 내 응답이 없으면, 실제 BLE 연동 없이 진행됐다고 보고 FAIL로 기록
      timeoutIdRef.current = setTimeout(() => {
        unsubscribeRef.current();
        finalizeBellOutcome('fail', isMock);
      }, BELL_RESULT_TIMEOUT_MS);
    } catch (error) {
      // BLE 연결 자체가 안 되어 있는 경우 — 결과 없이 즉시 FAIL로 기록
      console.log('하차벨 BLE 연결 실패:', error);
      finalizeBellOutcome('fail', true); // 연결 자체가 없었으니 명백히 mock
    }
  };

  // 하차벨 결과 저장
  // API_SPEC.md 기준: POST /api/trips/{tripId}/bell/result
  // - bellRequestId: 백엔드가 PATCH /status에서 생성한 값 (프론트에서 생성 금지)
  // - command: 백엔드가 반환한 STOP_REQUEST 값
  // - bellStatus: PENDING → SUCCESS 로 변경됨
  const sendBellResult = async (result, isMock) => {
    if (resultSentRef.current) return; // 중복 전송 방지
    resultSentRef.current = true;

    // 예모님 코멘트 P0-3(2026-08-14): result 값으로 먼저 분기하고, isMock은 부가 정보로만 붙인다.
    // 기존엔 isMock만 보고 문구를 정해서, result: 'FAIL'인데도 "작동 성공"으로 기록되는 모순이 있었다.
    const resultMessage =
      result === 'SUCCESS'
        ? (isMock ? 'mock 하차벨 작동 성공' : '실제 하차벨(BLE) 작동 성공')
        : (isMock ? 'BLE 미연결 - 하차벨 미작동' : '실제 하차벨(BLE) 응답 없음');

    try {
      await apiClient.trips.bell.result(tripId, {
        bellRequestId,
        command,
        result,
        resultMessage,
        isMock,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // errorCode별 처리 (13.2)
      if (error instanceof ApiError) {
        if (error.errorCode === 'BELL_REQUEST_NOT_FOUND') {
          // bellRequestId가 유효하지 않음 — 재시도해도 소용없으므로 재전송하지 않는다
          console.log('하차벨 요청을 찾을 수 없습니다:', bellRequestId);
          return;
        }
        if (error.errorCode === 'INVALID_BELL_STATE') {
          // 이미 SUCCESS·FAIL로 처리됨 — 재전송하지 않는다
          console.log('이미 처리된 하차벨 요청입니다:', bellRequestId);
          return;
        }
      }
      // 네트워크 실패 등은 재시도 가능하도록 플래그 되돌림
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

      <View
        style={styles.infoBox}
        accessible={true}
        accessibilityLabel={
          bellOutcome === 'waiting'
            ? BELL_OUTCOME_TEXT.waiting
            : `${BELL_OUTCOME_TEXT[bellOutcome]} 안전하게 하차 준비를 해주세요.`
        }
        accessibilityLiveRegion="polite"
      >
        {bellOutcome === 'waiting' && (
          <>
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginBottom: 10 }} />
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
        accessibilityRole="button"
        accessibilityLabel="처음으로 돌아가기"
        accessibilityHint="메인 화면으로 이동해서 다음 운행을 준비합니다"
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
    backgroundColor: '#B3261E', // 진한 레드 — 흰 글씨와의 대비를 강화한 경고색
    padding: 24,
  },

  emoji: {
    fontSize: 72,
    marginBottom: 20,
  },

  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 16,
  },

  message: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 32,
    textAlign: 'center',
  },

  // 결과 안내 박스 — 반투명 대신 불투명 흰 카드로, 진한 테두리로 경계 명확히
  infoBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    borderColor: '#7A1913',
    padding: 22,
    borderRadius: 18,
    alignItems: 'center',
    marginBottom: 36,
    width: '100%',
  },

  infoText: {
    fontSize: 19,
    lineHeight: 26,
    color: '#111111',
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },

  infoSubText: {
    fontSize: 16,
    color: '#333333',
    fontWeight: '600',
    textAlign: 'center',
  },

  // 처음으로 돌아가기 — 풀와이드, 큰 터치 영역
  button: {
    backgroundColor: '#FFFFFF',
    minHeight: 76,
    borderRadius: 18,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },

  buttonText: {
    color: '#B3261E',
    fontSize: 22,
    fontWeight: '800',
  },
});