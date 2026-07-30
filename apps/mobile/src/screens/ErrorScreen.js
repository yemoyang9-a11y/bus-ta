import React from 'react';
import { View, Text, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import * as Speech from 'expo-speech';

// 오류 화면
// API 호출 실패 시 navigation.navigate('Error')로 이동
// 시각장애인 접근성을 위해 화면 전체 터치로 처음 화면 복귀 (별도 버튼 없음)
// 오류 원인을 특정하지 않고 포괄적인 안내 문구 사용
// (네트워크/서버/데이터 등 다양한 원인이 catch 하나로 처리되기 때문)
export default function ErrorScreen({ navigation }) {
  React.useEffect(() => {
    Speech.speak('오류가 발생했습니다. 잠시 후 다시 시도해주세요. 화면을 터치하면 처음으로 돌아갑니다.', {
      language: 'ko',
    });
  }, []);

  const handleReturnToMain = () => {
    Speech.stop();
    navigation.navigate('Main');
  };

  return (
    <TouchableWithoutFeedback onPress={handleReturnToMain}>
      <View style={styles.container}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={styles.title}>오류 발생</Text>
        <Text style={styles.message}>잠시 후 다시 시도해주세요.</Text>
        <Text style={styles.guideText}>화면을 터치하면 처음으로 돌아갑니다</Text>
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
    padding: 20,
  },
  emoji: {
    fontSize: 80,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  message: {
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  guideText: {
    fontSize: 15,
    color: '#999',
    textAlign: 'center',
  },
});