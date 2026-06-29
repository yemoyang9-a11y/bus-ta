import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import * as Speech from 'expo-speech';

// 메인 화면
// 앱 시작 시 TTS 안내 후 화면 터치하면 STT 화면으로 이동
// 백엔드 연결 시 이 파일은 수정 없이 그대로 사용
export default function MainScreen({ navigation }) {
  useEffect(() => {
    // 앱 시작 시 자동 TTS 안내
    Speech.speak('지금부터 대중교통 보조 앱을 실행하겠습니다. 아무 화면이나 터치하세요.', { language: 'ko' });
  }, []);

  return (
    // 화면 아무 곳이나 터치하면 STT 화면으로 이동
    <TouchableWithoutFeedback onPress={() => navigation.navigate('STT')}>
      <View style={styles.container}>
        <Text style={styles.title}>버스 도우미</Text>
        <Text style={styles.subtitle}>시각장애인 대중교통 보조 앱</Text>
        <Text style={styles.hint}>🎤 화면을 터치하면 시작됩니다</Text>
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
});