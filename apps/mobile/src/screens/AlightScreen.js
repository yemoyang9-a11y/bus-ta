import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import axios from 'axios';
import { useFocusEffect } from '@react-navigation/native';

// =============================================
// [백엔드 연결 시 수정 1] API 주소 변경
// 'http://백엔드IP:포트' → ngrok 주소로 변경
// 예: 'https://abc123.ngrok.io'
// =============================================
const API_BASE_URL = 'http://백엔드IP:포트';

export default function AlightScreen({ route, navigation }) {
  // RidingScreen에서 전달받은 값들
  // - tripId: 운행 ID
  // - bellRequestId: 백엔드가 PATCH /status에서 생성한 하차벨 요청 ID
  // - command: 백엔드가 반환한 STOP_REQUEST 값
  // - guideMessage: 백엔드 안내 문장 (유나 AI 모듈 생성)
  const { tripId, bellRequestId, command, guideMessage } = route.params;
  const resultSentRef = useRef(false); // 중복 전송 방지

  useFocusEffect(
    React.useCallback(() => {
      const timer = setTimeout(() => {
        // guideMessage가 있으면 백엔드(유나) 안내 문장 우선 출력
        // 없으면 기본 안내 문장 출력
        const ttsMessage = guideMessage || '하차까지 한 정류장 남았습니다. 다음 정류장에서 하차하세요.';
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
  const sendBellResult = async () => {
    if (resultSentRef.current) return; // 중복 전송 방지
    resultSentRef.current = true;

    try {
      // =============================================
      // [백엔드 연결 시 수정 2] 아래 주석 해제
      // =============================================
      // await axios.post(`${API_BASE_URL}/api/trips/${tripId}/bell/result`, {
      //   bellRequestId,   // 백엔드가 생성한 bellRequestId (프론트 생성 금지)
      //   command,         // 백엔드가 반환한 STOP_REQUEST
      //   result: 'SUCCESS',
      //   resultMessage: 'mock 하차벨 작동 성공',
      //   isMock: true,
      //   timestamp: new Date().toISOString(),
      // });

      // [백엔드 연결 시 수정 3] 아래 console.log 삭제
      console.log('bell/result 전송 완료 (mock):', { tripId, bellRequestId, command });
    } catch (error) {
      console.log('bell/result 전송 실패:', error);
      resultSentRef.current = false;
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🚨</Text>
      <Text style={styles.title}>하차 안내</Text>
      <Text style={styles.message}>
        {guideMessage || '다음 정류장에서 하차하세요.'}
      </Text>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>✅ 하차벨이 요청되었습니다.</Text>
        <Text style={styles.infoSubText}>안전하게 하차 준비를 해주세요.</Text>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('Main')}
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