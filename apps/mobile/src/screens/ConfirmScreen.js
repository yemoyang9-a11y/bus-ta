import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';

const API_BASE_URL = 'http://백엔드IP:포트';

// 백엔드 연결 전 임시 mock 데이터
// API_SPEC.md 기준 필드명으로 수정됨
// candidateId, localBusId, gbisStationId 사용 / stationId, routeId, routeDirection, endStationName 삭제
const MOCK_ROUTE_RESPONSE = {
  success: true,
  destination: '병점역',
  routes: [
    {
      candidateId: 1,
      routeNo: '700-2',
      localBusId: '234000021',
      gbisStationId: '201000166',
      boardingStation: {
        stationName: '오목천역.영신여자고교.청구아파트',
        latitude: 37.242027,
        longitude: 126.962801,
      },
      destinationStation: {
        stationName: '병점역',
        latitude: 37.213789,
        longitude: 126.979749,
      },
      stationList: [
        { stationName: '오목천역.영신여자고교.청구아파트', latitude: 37.242027, longitude: 126.962801, sequence: 0 },
        { stationName: '수영오거리.방송통신대입구', latitude: 37.237447, longitude: 126.962515, sequence: 1 },
        { stationName: '병점역', latitude: 37.213789, longitude: 126.979749, sequence: 10 },
      ],
      totalTime: 30,
      recommendationReason: '환승이 없고 이동 구조가 단순합니다.',
      guideMessage: '700다시2번 버스를 이용할 수 있습니다.',
    },
  ],
  message: '노선 후보를 조회했습니다.',
};

export default function ConfirmScreen({ route, navigation }) {
  const { destinationText } = route.params;
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef(null);

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
      // GPS 좌표 조회
      const { status } = await Location.requestForegroundPermissionsAsync();
      let latitude = 37.242027;
      let longitude = 126.962801;

      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
      }

      // 백엔드 연결 후 아래 주석 해제 + 아래 mock 데이터 줄 주석처리
      // const res = await axios.post(`${API_BASE_URL}/api/routes/search`, {
      //   destination: destinationText,
      //   latitude,
      //   longitude,
      // });
      // const data = res.data;

      // 백엔드 연결 후 이 줄 주석처리
      const data = MOCK_ROUTE_RESPONSE;

      // TTS 끝난 후에 화면 이동
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