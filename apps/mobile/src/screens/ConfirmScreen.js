import React, { useRef } from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';

// =============================================
// [백엔드 연결 시 수정 1] API 주소 변경
// 'http://백엔드IP:포트' → ngrok 주소로 변경
// 예: 'https://abc123.ngrok.io'
// =============================================
const API_BASE_URL = 'http://백엔드IP:포트';

// =============================================
// 백엔드 연결 전 임시 mock 데이터
// 백엔드 연결 후에는 POST /api/routes/search 응답으로 대체됨
// API_SPEC.md 기준 필드명:
// - candidateId, localBusId, gbisStationId 사용
// - stationId, routeId, routeDirection, endStationName 사용 안 함
// =============================================
const MOCK_ROUTE_RESPONSE = {
  success: true,
  destination: '병점역',
  routes: [
    {
      candidateId: 7,
      routeNo: '1551',
      localBusId: '234001138',
      gbisStationId: '233001214',
      boardingStation: {
        stationName: '수원대학교',
        latitude: 37.213789,
        longitude: 126.979772,
      },
      destinationStation: {
        stationName: '병점역후문',
        latitude: 37.20601,
        longitude: 127.032047,
      },
      stationList: [
        { stationName: '수원대학교', latitude: 37.213789, longitude: 126.979772, sequence: 0 },
        { stationName: '수원대학교', latitude: 37.211553, longitude: 126.983813, sequence: 1 },
        { stationName: '융건릉사거리', latitude: 37.207917, longitude: 126.987467, sequence: 2 },
        { stationName: '융건릉입구', latitude: 37.206768, longitude: 126.988969, sequence: 3 },
        { stationName: '중외제약사거리', latitude: 37.201489, longitude: 127.003042, sequence: 4 },
        { stationName: '신한미지엔아파트앞', latitude: 37.199896, longitude: 127.008616, sequence: 5 },
        { stationName: '북촌말입구', latitude: 37.202668, longitude: 127.013649, sequence: 6 },
        { stationName: '송산동입구', latitude: 37.205545, longitude: 127.017194, sequence: 7 },
        { stationName: '동문아파트', latitude: 37.205397, longitude: 127.022232, sequence: 8 },
        { stationName: '진안5통.병점육교', latitude: 37.208672, longitude: 127.03038, sequence: 9 },
        { stationName: '병점역후문', latitude: 37.20601, longitude: 127.032047, sequence: 10 },
      ],
      totalTime: 19,
      totalWalk: 134,
      payment: 3200,
      busTransitCount: 1,
      busStationCount: 9,
      totalDistance: 5879,
      intervalTime: 50,
      recommendationReason: '환승이 없고 이동 구조가 단순합니다.',
      guideMessage: '1551번 버스를 이용할 수 있습니다.',
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
      const { status } = await Location.requestForegroundPermissionsAsync();
      let latitude = 37.213789;
      let longitude = 126.979772;

      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
      }

      // =============================================
      // [백엔드 연결 시 수정 2] 아래 주석 해제
      // POST /api/routes/search 호출
      // =============================================
      // const res = await axios.post(`${API_BASE_URL}/api/routes/search`, {
      //   destination: destinationText,
      //   latitude,
      //   longitude,
      // });
      // const data = res.data;

      // =============================================
      // [백엔드 연결 시 수정 3] 아래 줄 주석처리
      // =============================================
      const data = MOCK_ROUTE_RESPONSE;

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