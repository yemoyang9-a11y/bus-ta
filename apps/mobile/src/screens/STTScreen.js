import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';

export default function STTScreen({ navigation }) {
  const [destination, setDestination] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState('안내 음성 준비 중...');

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

    setTimeout(() => {
      const recognizedText = '병점역';
      setDestination(recognizedText);
      setIsListening(false);
      setStatus('인식 완료!');

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