import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import * as Speech from 'expo-speech';
import { useRealtime } from '../realtime/RealtimeProvider';

// 메인 화면
// 앱 시작 시 TTS 안내 후 화면 터치하면 STT 화면으로 이동
// 백엔드 연결 시 이 파일은 수정 없이 그대로 사용
export default function MainScreen({ navigation }) {
  const { connect, isConnected } = useRealtime();

  useEffect(() => {
    // 앱 시작 시 자동 TTS 안내
    Speech.speak('지금부터 대중교통 보조 앱을 실행하겠습니다. 아무 화면이나 터치하세요.', { language: 'ko' });

    // 예모님 코멘트 1번(2026-08-13): connect()를 실제로 호출하는 곳이 없어
    // session.transport가 계속 null이던 문제 해결.
    // 실패해도 화면 흐름(터치→STT 이동)은 그대로 진행되도록 catch로 감싼다.
    connect().catch((error) => {
      console.log('Realtime 세션 연결 실패:', error);
    });
  }, []);

  return (
    // 화면 아무 곳이나 터치하면 STT 화면으로 이동
    <TouchableWithoutFeedback onPress={() => navigation.navigate('STT')}>
      <View style={styles.container}>
        <Text style={styles.title}>버스 도우미</Text>
        <Text style={styles.subtitle}>시각장애인 대중교통 보조 앱</Text>
        <Text style={styles.hint}>🎤 화면을 터치하면 시작됩니다</Text>
        {isConnected && <Text style={styles.connectedHint}>● 음성 연결됨</Text>}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 50,
  },
  hint: {
    fontSize: 16,
    color: '#2196F3',
    marginTop: 20,
  },
  connectedHint: {
    fontSize: 13,
    color: '#4CAF50',
    marginTop: 10,
  },
});