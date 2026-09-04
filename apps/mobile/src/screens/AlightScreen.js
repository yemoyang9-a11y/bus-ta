import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { useRealtime } from '../realtime/RealtimeProvider';
import { connectBell, getBellDeviceName, isBellConnected, sendStopRequest, subscribeBellResult, disconnect } from '../ble/bleManager';
import { sendStopRequestWithReconnect } from '../ble/bell-command-sender';

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
        requestActualBellStop().catch((error) => {
          console.log('하차벨 처리 실패:', error);
        });
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
            requestActualBellStop().catch((error) => {
              console.log('하차벨 처리 실패:', error);
            });
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

  const requestActualBellStop = async () => {
    const isMock = state.bleIsMock ?? true;

    const handleBellResult = (result) => {
      console.log('[BLE] 하차벨 결과 Notify 수신:', result);

      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      unsubscribeRef.current();
      finalizeBellOutcome(result.result === 'SUCCESS' ? 'success' : 'fail', isMock);
    };

    // 하차벨은 탑승 확정 직후 RidingScreen 이 이미 연결해 둔다. 다만 버스 안에서
    // 흔들리다 끊겼을 수 있으므로, 실제 장치에 연결 여부를 물어보고 끊겼으면 다시
    // 붙인 뒤에 보낸다. 전송이 실패하면 한 번 더 붙여 다시 보낸다. 곧 내려야 하므로
    // 여기서 반복하지는 않는다.
    const { sent, unsubscribe } = await sendStopRequestWithReconnect({
      isConnected: isBellConnected,
      connect: () => connectBell(state.targetBeaconId ?? undefined),
      subscribeResult: () => subscribeBellResult(handleBellResult),
      sendStopRequest,
    });

    if (!isMountedRef.current) {
      unsubscribe();
      return;
    }

    unsubscribeRef.current = unsubscribe;

    if (!sent) {
      // 명령이 나가지 못했다. 결과가 올 리 없으므로 10초를 기다리지 않고 확정한다.
      // 실제 하차벨이 동작하지 않았으므로 mock 으로 기록한다.
      console.log('하차벨 STOP_REQUEST 전송 실패 - 결과를 기다리지 않고 실패 처리');
      finalizeBellOutcome('fail', true);
      return;
    }

    timeoutIdRef.current = setTimeout(() => {
      unsubscribeRef.current();
      finalizeBellOutcome('fail', isMock);
    }, BELL_RESULT_TIMEOUT_MS);
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
    disconnect(getBellDeviceName()).catch(() => {});
    dispatch({ type: 'RESET_TRIP' });
    navigation.navigate('Main');
  };

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <Text style={styles.title}>하차 안내</Text>

        <View style={styles.messageBox}>
          <Text style={styles.messageIcon}>⚠️</Text>
          <Text style={styles.message}>
            하차벨을 요청했습니다. 안전하게 하차하세요.
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
        <TouchableOpacity
          style={styles.button}
          onPress={handleGoHome}
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