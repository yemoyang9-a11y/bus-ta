import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { connectAll, setTargetBeacon, startBeaconScan } from '../ble/bleManager';

export default function RouteListScreen({ navigation }) {
  // 예모님 확인(2026-08-15): ConfirmScreen 삭제에 따라 route.params 대신 TripContext에서 값을 가져온다.
  // destination, routeCandidates는 function-dispatcher.ts의 search_routes 처리 결과로 채워진다.
  const { state, dispatch } = useTrip();
  const { destination, routeCandidates } = state;
  // guideMessage는 별도 필드가 없어, 첫 번째 후보에 실려온 안내 문장을 그대로 사용한다
  // (기존 ConfirmScreen이 data.routes[0]?.guideMessage로 쓰던 방식과 동일)
  const guideMessage = routeCandidates?.[0]?.guideMessage || '';

  const [loading, setLoading] = useState(false);

  // 채린님 확인(2026-08-15): Realtime 세션이 이미 같은 내용을 음성으로 안내하고 있어서,
  // 화면 TTS(Speech.speak)와 겹쳐 들리는 문제 발견 — 이 화면의 TTS 호출을 제거한다.
  // guideMessage는 텍스트로만 표시(보조 정보), 음성 안내는 Realtime 대화가 전담한다.

  // 정민님 확인(2026-08-12): 노선 선택 후(=여기) BLE 연결 시작, 배터리 절약을 위해
  // 앱 켤 때가 아니라 실제 필요 시점에 연결한다.
  // BLE는 보조 기능이라, 실패해도 노선 안내 자체(화면 전환)는 막지 않는다.
  //
  // 예모님 코멘트 3번(2026-08-13): BleManager 인스턴스가 하나뿐이라 스캔을 두 번
  // 따로 시작하면 서로의 stopDeviceScan()이 충돌했다. 스캔을 한 번만 실행해
  // 두 기기를 동시에 찾는 connectAll()로 변경.
  //
  // 예모님 코멘트 P0-2(2026-08-14): 지팡이 스캔이 실제로 시작됐는지 TripContext에
  // 기록해야, RidingScreen이 stopBeaconScan()을 정확한 시점에만 시도할 수 있다.
  // setTargetBeacon·startBeaconScan까지 전부 성공했을 때만 beaconScanActive: true로 표시한다.
  //
  // @returns {boolean} 하차벨(비콘 겸용) 연결 성공 여부 — TripContext에 전달할 isMock 판단에 사용
  const setupBle = async (targetBeaconId) => {
    const connected = await connectAll();

    if (connected.has('White_cane')) {
      try {
        await setTargetBeacon(targetBeaconId);
        await startBeaconScan();
        dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: true });
      } catch (error) {
        console.log('스마트지팡이 명령 전송 실패:', error);
      }
    } else {
      console.log('스마트지팡이 연결 실패');
    }

    const bellConnected = connected.has('BUS_1551_001');
    if (!bellConnected) {
      console.log('하차벨 연결 실패');
    }

    return bellConnected;
  };

  // 노선 선택 시 POST /api/trips 호출 후 탑승 중 화면으로 이동
  const selectRoute = async (selectedRoute) => {
    setLoading(true);

    dispatch({ type: 'SELECT_ROUTE', route: selectedRoute });

    try {
      // 공통 API 명세서 5.2 기준 필드만 전달 (guideMessage·recommendationReason 등
      // 스펙에 없는 필드는 보내지 않는다 — 백엔드 스키마 검증 대상이 아님)
      const tripRequest = {
        destination: destination || selectedRoute.destinationStation?.stationName,
        candidateId: selectedRoute.candidateId,
        routeNo: selectedRoute.routeNo,
        localBusId: selectedRoute.localBusId,
        gbisStationId: selectedRoute.gbisStationId,
        boardingStation: selectedRoute.boardingStation,
        destinationStation: selectedRoute.destinationStation,
        stationList: selectedRoute.stationList,
        totalTime: selectedRoute.totalTime,
        totalWalk: selectedRoute.totalWalk,
        payment: selectedRoute.payment,
        busTransitCount: selectedRoute.busTransitCount,
        busStationCount: selectedRoute.busStationCount,
        totalDistance: selectedRoute.totalDistance,
        intervalTime: selectedRoute.intervalTime,
      };

      const data = await apiClient.trips.create(tripRequest);

      dispatch({ type: 'START_TRIP', tripId: data.tripId });

      // 예모님 코멘트 5번 반영: BLE 연결은 화면 전환을 기다리지 않는다.
      // 예모님 코멘트 2번 반영: 서버가 알려준 isMock을 보존해서, 실제 BLE 교신 여부와
      // 무관하게 무조건 isMock: false로 기록되던 문제를 해결한다.
      apiClient.beacons
        .list(selectedRoute.routeNo)
        .then(async (beaconData) => {
          const bleConnected = await setupBle(beaconData.targetBeaconId);
          dispatch({
            type: 'SET_BLE_MOCK_STATUS',
            isMock: beaconData.isMock || !bleConnected,
          });
        })
        .catch((beaconError) => {
          console.log('비콘 조회 실패:', beaconError);
          dispatch({ type: 'SET_BLE_MOCK_STATUS', isMock: true });
        });

      navigation.navigate('Riding', { tripId: data.tripId, selectedRoute });
    } catch (error) {
      // errorCode별 분기 (13.2)
      if (error instanceof ApiError && error.errorCode === 'INVALID_STATION_LIST') {
        // 선택한 후보 자체가 규칙을 어긴 경우. 임의로 보정하지 않고 오류 화면으로.
      }
      navigation.navigate('Error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={{ marginTop: 20 }}>운행을 준비하는 중...</Text>
      </View>
    );
  }

  // 노선 없을 때 처리
  if (!routeCandidates || routeCandidates.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>이용 가능한 노선이 없습니다.</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.navigate('Main')}>
          <Text style={styles.backButtonText}>처음으로</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 보조 정보 표시용 — 음성 안내는 Realtime 대화가 전담 (Speech.speak 없음) */}
      <Text style={styles.guideMessage}>{guideMessage}</Text>
      <FlatList
        data={routeCandidates}
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