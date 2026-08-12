import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';

export default function AlightScreen({ route, navigation }) {
  // RidingScreen에서 전달받은 값들
  // - tripId: 운행 ID
  // - bellRequestId: 백엔드가 PATCH /status에서 생성한 하차벨 요청 ID
  // - command: 백엔드가 반환한 STOP_REQUEST 값
  // - guideMessage: 백엔드 안내 문장 (유나 AI 모듈 생성, 탑승 중 화면용 문장)
  const { tripId, bellRequestId, command, guideMessage } = route.params;
  const resultSentRef = useRef(false); // 중복 전송 방지
  const { dispatch } = useTrip();

  useFocusEffect(
    React.useCallback(() => {
      const timer = setTimeout(() => {
        // 하차 안내 화면 전용 TTS 문장 (탑승 중 화면과 중복되지 않도록 별도 문장 사용)
        const ttsMessage = '하차벨을 요청했습니다. 안전하게 하차하세요.';
        Speech.speak(ttsMessage, {
          language: 'ko',
          onDone: () => {
            sendBellResult();
          },
        });
      }, 500);

      return () => {
        clearTimeout(timer);
        Speech.stop();
      };
    }, [])
  );

  // 하차벨 결과 저장
  // API_SPEC.md 기준: POST /api/trips/{tripId}/bell/result
  // - bellRequestId: 백엔드가 PATCH /status에서 생성한 값 (프론트에서 생성 금지)
  // - command: 백엔드가 반환한 STOP_REQUEST 값
  // - bellStatus: PENDING → SUCCESS 로 변경됨
  // TODO(Phase 7): 실제 BLE 스마트지팡이 결과로 대체. 현재는 mock 성공 결과를 보낸다.
  const sendBellResult = async () => {
    if (resultSentRef.current) return; // 중복 전송 방지
    resultSentRef.current = true;

    try {
      await apiClient.trips.bell.result(tripId, {
        bellRequestId,
        command,
        result: 'SUCCESS',
        resultMessage: 'mock 하차벨 작동 성공',
        isMock: true,
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

  // 처음으로 돌아가기 — 다음 운행을 위해 공유 상태 초기화
  const handleGoHome = () => {
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
        <Text style={styles.infoText}>✅ 하차벨이 요청되었습니다.</Text>
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