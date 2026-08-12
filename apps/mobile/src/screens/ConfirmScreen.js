import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';

export default function ConfirmScreen({ route, navigation }) {
  const { destinationText } = route.params;
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef(null);
  const { dispatch } = useTrip();

  useFocusEffect(
    React.useCallback(() => {
      const timer = setTimeout(() => {
        Speech.speak(
          `목적지가 ${destinationText}로 인식되었습니다. 맞으면 화면을 한 번 터치하세요. 틀리면 두 번 터치하세요.`,
          { language: 'ko' }
        );
      }, 500);

      return () => {
        clearTimeout(timer);
        Speech.stop();
      };
    }, [destinationText])
  );

  const handleTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

    tapTimerRef.current = setTimeout(() => {
      if (tapCountRef.current === 1) {
        handleSearch();
      } else if (tapCountRef.current >= 2) {
        Speech.stop();
        Speech.speak('다시 입력합니다.', {
          language: 'ko',
          onDone: () => navigation.goBack(),
        });
      }
      tapCountRef.current = 0;
    }, 300);
  };

  const handleSearch = async () => {
    Speech.stop();

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let latitude = 37.213789;
      let longitude = 126.979772;

      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
      }

      const data = await apiClient.routes.search({
        destination: destinationText,
        latitude,
        longitude,
      });

      if (!data.routes || data.routes.length === 0) {
        Speech.speak('이용 가능한 노선을 찾지 못했습니다. 목적지를 다시 말씀해주세요.', {
          language: 'ko',
          onDone: () => navigation.goBack(),
        });
        return;
      }

      dispatch({
        type: 'SET_DESTINATION_AND_ROUTES',
        destination: destinationText,
        routes: data.routes,
      });

      Speech.speak('경로를 검색합니다.', {
        language: 'ko',
        onDone: () => {
          navigation.navigate('RouteList', {
            destinationText,
            routes: data.routes,
            guideMessage: data.routes[0]?.guideMessage || '',
          });
        },
      });
    } catch (error) {
      // errorCode별 분기 (13.2)
      if (error instanceof ApiError) {
        if (error.errorCode === 'ROUTE_SEARCH_FAILED') {
          Speech.speak('경로 검색에 실패했습니다. 잠시 후 다시 시도해주세요.', { language: 'ko' });
        }
        // INVALID_REQUEST 등 기타 오류는 ErrorScreen에서 공통 처리
      }
      navigation.navigate('Error');
    }
  };

  return (
    <TouchableWithoutFeedback onPress={handleTap}>
      <View style={styles.container}>
        <Text style={styles.title}>목적지 확인</Text>
        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>인식된 목적지</Text>
          <Text style={styles.resultText}>{destinationText}</Text>
        </View>
        <Text style={styles.guideText}>한 번 터치 → 경로 검색</Text>
        <Text style={styles.guideText}>두 번 터치 → 다시 입력</Text>
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 40,
  },
  resultBox: {
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    padding: 30,
    borderRadius: 15,
    marginBottom: 40,
    width: '100%',
  },
  resultLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 10,
  },
  resultText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
  },
  guideText: {
    fontSize: 16,
    color: '#555',
    marginBottom: 10,
  },
});