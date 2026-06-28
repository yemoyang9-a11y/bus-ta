import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';

// STT 화면
// 현재 mock STT로 구현되어 있음
// 실제 STT 구현은 EAS Build + @react-native-voice/voice 필요 (7/1 이후 예정)
export default function STTScreen({ navigation }) {
  const [destination, setDestination] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState('안내 음성 준비 중...');

  // 화면 진입/복귀 시마다 초기화 후 TTS + mock STT 시작
  // 목적지 확인 화면에서 "다시 입력" 눌렀을 때도 여기로 돌아와서 재시작됨
  useFocusEffect(
    React.useCallback(() => {
      setDestination('');
      setIsListening(false);
      setStatus('안내 음성 준비 중...');

      Speech.speak('목적지를 말해주세요', {
        language: 'ko',
        onDone: () => {
          startListening();
        },
      });

      return () => {
        Speech.stop();
      };
    }, [])
  );

  const startListening = () => {
    setIsListening(true);
    setStatus('듣고 있어요...');

    // =============================================
    // 현재 mock STT 구현
    // 3초 후 고정값 '병점역'을 자동으로 인식된 것처럼 처리
    // 실제 STT 구현 시 이 setTimeout 블록을 @react-native-voice/voice로 교체
    // =============================================
    setTimeout(() => {
      const recognizedText = '병점역'; // mock STT 고정값 (시연용)
      setDestination(recognizedText);
      setIsListening(false);
      setStatus('인식 완료!');

      // 인식된 목적지 TTS 출력 후 목적지 확인 화면으로 이동
      Speech.speak(`${recognizedText}`, {
        language: 'ko',
        onDone: () => {
          navigation.navigate('Confirm', { destinationText: recognizedText });
        },
      });
    }, 3000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>목적지를 말해주세요</Text>

      {isListening && (
        <View style={styles.listeningBox}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.listeningText}>🎤 듣고 있어요...</Text>
        </View>
      )}

      {destination !== '' && (
        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>인식된 목적지</Text>
          <Text style={styles.resultText}>{destination}</Text>
        </View>
      )}

      <Text style={styles.statusText}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 40,
  },
  listeningBox: {
    alignItems: 'center',
    marginBottom: 30,
  },
  listeningText: {
    fontSize: 18,
    color: '#2196F3',
    marginTop: 15,
  },
  resultBox: {
    alignItems: 'center',
    marginBottom: 20,
  },
  resultLabel: {
    fontSize: 14,
    color: '#888',
  },
  resultText: {
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 5,
    color: '#333',
  },
  statusText: {
    fontSize: 14,
    color: '#aaa',
    marginTop: 20,
  },
});