import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';

const API_BASE_URL = 'http://백엔드IP:포트';

export default function RouteListScreen({ route, navigation }) {
  const { destinationText, routes, guideMessage } = route.params;
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      const timer = setTimeout(() => {
        if (guideMessage) {
          Speech.speak(guideMessage, { language: 'ko' });
        }
      }, 500);

      return () => {
        clearTimeout(timer);
        Speech.stop();
      };
    }, [guideMessage])
  );

  const selectRoute = async (selectedRoute) => {
    try {
      Speech.stop();

      // 백엔드 연결 후 아래 주석 해제 + mock tripId 줄 주석처리
      // API_SPEC.md 기준:
      // - routeId, routeDirection, endStationName 삭제
      // - candidateId, localBusId, gbisStationId 추가
      // const res = await axios.post(`${API_BASE_URL}/api/trips`, {
      //   destination: destinationText,
      //   candidateId: selectedRoute.candidateId,
      //   routeNo: selectedRoute.routeNo,
      //   localBusId: selectedRoute.localBusId,
      //   gbisStationId: selectedRoute.gbisStationId,
      //   boardingStation: selectedRoute.boardingStation,
      //   destinationStation: selectedRoute.destinationStation,
      //   stationList: selectedRoute.stationList,
      //   totalTime: selectedRoute.totalTime,
      //   totalWalk: selectedRoute.totalWalk,
      //   payment: selectedRoute.payment,
      //   busTransitCount: selectedRoute.busTransitCount,
      //   busStationCount: selectedRoute.busStationCount,
      //   totalDistance: selectedRoute.totalDistance,
      //   intervalTime: selectedRoute.intervalTime,
      // });
      // const tripId = res.data.tripId;

      // 백엔드 연결 후 이 줄 주석처리
      const tripId = 'trip-001';

      navigation.navigate('Riding', { tripId, selectedRoute });
    } catch (error) {
      navigation.navigate('Error');
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={{ marginTop: 20 }}>노선 검색 중...</Text>
      </View>
    );
  }

  if (!routes || routes.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>이용 가능한 노선이 없습니다.</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>다시 검색</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.guideMessage}>{guideMessage}</Text>
      <FlatList
        data={routes}
        keyExtractor={(item) => String(item.candidateId)}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.routeCard} onPress={() => selectRoute(item)}>
            <Text style={styles.routeNo}>{item.routeNo}번</Text>
            <Text style={styles.routeInfo}>탑승 정류장: {item.boardingStation.stationName}</Text>
            <Text style={styles.routeInfo}>하차 정류장: {item.destinationStation.stationName}</Text>
            {item.totalTime && (
              <Text style={styles.routeInfo}>예상 소요 시간: {item.totalTime}분</Text>
            )}
            {item.recommendationReason && (
              <Text style={styles.routeReason}>{item.recommendationReason}</Text>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  guideMessage: {
    fontSize: 16,
    color: '#333',
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#E3F2FD',
    borderRadius: 10,
  },
  routeCard: {
    backgroundColor: '#f5f5f5',
    padding: 20,
    borderRadius: 10,
    marginBottom: 15,
    borderLeftWidth: 5,
    borderLeftColor: '#2196F3',
  },
  routeNo: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  routeInfo: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
  },
  routeReason: {
    fontSize: 13,
    color: '#2196F3',
    marginTop: 8,
    fontStyle: 'italic',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    color: '#555',
    marginBottom: 30,
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    width: 200,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});