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
    <TouchableWithoutFeedback
      onPress={handleReturnToMain}
      accessibilityRole="button"
      accessibilityLabel="오류가 발생했습니다. 잠시 후 다시 시도해주세요."
      accessibilityHint="화면 어디든 터치하면 처음 화면으로 돌아갑니다"
    >
      <View style={styles.container}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={styles.title}>오류 발생</Text>
        <Text style={styles.message}>잠시 후 다시 시도해주세요.</Text>

        <View style={styles.guideBox}>
          <Text style={styles.guideText}>화면을 터치하면 처음으로 돌아갑니다</Text>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F7FA', // 다른 화면들과 통일된 배경
    padding: 24,
  },

  emoji: {
    fontSize: 72,
    marginBottom: 20,
  },

  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#111111',
    marginBottom: 16,
  },

  message: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 32,
    textAlign: 'center',
  },

  // 안내 문구 — 카드 형태로 감싸서 "이게 지금 할 수 있는 행동"이라는 걸 시각적으로 구분
  guideBox: {
    backgroundColor: '#1E4FD8',
    borderWidth: 2.5,
    borderColor: '#0F2E8C',
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 28,
    width: '100%',
  },

  guideText: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});