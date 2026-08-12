import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { sendStopRequest, subscribeBellResult, disconnect } from '../ble/bleManager';

// 정민님 확인(2026-08-12): 하차벨 응답을 못 받을 경우를 대비한 대기 시간
const BELL_RESULT_TIMEOUT_MS = 10000;

export default function AlightScreen({ route, navigation }) {
  // RidingScreen에서 전달받은 값들
  // - tripId: 운행 ID
  // - bellRequestId: 백엔드가 PATCH /status에서 생성한 하차벨 요청 ID
  // - command: 백엔드가 반환한 STOP_REQUEST 값
  // - guideMessage: 백엔드 안내 문장 (유나 AI 모듈 생성, 탑승 중 화면용 문장)
  const { tripId, bellRequestId, command, guideMessage } = route.params;
  const resultSentRef = useRef(false); // 중복 전송 방지
  const { dispatch } = useTrip();
  const [waitingForBell, setWaitingForBell] = useState(true);

  useFocusEffect(
    React.useCallback(() => {
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
      };
    }, [])
  );

  // 실제 하차벨(BLE)에 STOP_REQUEST를 전송하고, 결과(Notify)를 구독해서 받는다.
  // (2026-08-12, GitHub 리뷰 2번 반영: mock 고정값 대신 실제 BLE 결과 사용)
  const requestActualBellStop = () => {
    let unsubscribe = () => {};
    let timeoutId;

    const handleBellResult = (result) => {
      clearTimeout(timeoutId);
      unsubscribe();
      setWaitingForBell(false);
      sendBellResult(result.result === 'SUCCESS' ? 'SUCCESS' : 'FAIL', false);
    };

    try {
      unsubscribe = subscribeBellResult(handleBellResult);

      // 결과를 기다리는 동안 명령 전송
      sendStopRequest().catch((error) => {
        console.log('하차벨 명령 전송 실패:', error);
      });

      // 정해진 시간 내 응답이 없으면, 실제 BLE 연동 없이 진행됐다고 보고 FAIL로 기록
      timeoutId = setTimeout(() => {
        unsubscribe();
        setWaitingForBell(false);
        sendBellResult('FAIL', false);
      }, BELL_RESULT_TIMEOUT_MS);
    } catch (error) {
      // BLE 연결 자체가 안 되어 있는 경우 — 결과 없이 즉시 FAIL로 기록
      console.log('하차벨 BLE 연결 실패:', error);
      setWaitingForBell(false);
      sendBellResult('FAIL', false);
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

    try {
      await apiClient.trips.bell.result(tripId, {
        bellRequestId,
        command,
        result,
        resultMessage: isMock ? 'mock 하차벨 작동 성공' : '실제 하차벨(BLE) 응답',
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
        {waitingForBell ? (
          <>
            <ActivityIndicator size="small" color="#fff" style={{ marginBottom: 8 }} />
            <Text style={styles.infoText}>하차벨 응답을 기다리는 중...</Text>
          </>
        ) : (
          <Text style={styles.infoText}>✅ 하차벨이 요청되었습니다.</Text>
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