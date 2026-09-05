import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { apiClient, ApiError } from '../api/client';
import { useTrip } from '../state/TripContext';
import { stopBeaconScan } from '../ble/bleManager';

// 예모님 확정(2026-08-28): 후보 유효시간 5분. TripContext.js와 동일한 값을 써야 하므로
// 상수 자체는 여기서도 다시 정의하되, 계산 방식(검색 시각 + 5분)은 TripContext가 갖고 있다.
const ROUTE_CANDIDATES_TTL_MS = 5 * 60 * 1000;

function isRouteCandidatesExpired(expiresAt) {
  if (!expiresAt) return true;
  return Date.now() > expiresAt;
}

export default function RouteListScreen({ navigation }) {
  // 예모님 확인(2026-08-15): ConfirmScreen 삭제에 따라 route.params 대신 TripContext에서 값을 가져온다.
  // destination, routeCandidates는 function-dispatcher.ts의 search_routes 처리 결과로 채워진다.
  const { state, dispatch } = useTrip();
  const { destination, routeCandidates, routeCandidatesExpiresAt } = state;

  const [loading, setLoading] = useState(false);

  // 채린님 확인(2026-08-15): AI가 이미 노선 후보를 음성으로 안내하므로,
  // 화면 상단의 guideMessage 텍스트(중복 안내)는 제거한다.

  // 채린님 임시 조치(2026-08-28): 서버가 최대 5개까지 routeCandidates를 응답에
  // 담아 보내면서, 화면에 제한 로직이 없어 전부 리스트로 노출되던 문제를 발견.
  // "다른 버스 없어요?" 시 다음 후보를 보여주는 정식 기능(유나님 파트)이 완성되기 전까지,
  // 시연을 위해 임시로 상위 2개만 화면에 보여준다. 정식 기능 완성 후 이 slice는 제거하고
  // announcedCandidateIds 기반으로 다시 설계해야 한다.
  const visibleRouteCandidates = routeCandidates
    ? routeCandidates.slice(0, 2)
    : routeCandidates;

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
  // 노선 선택 시 POST /api/trips 호출 후 탑승 중 화면으로 이동
  const selectRoute = async (selectedRoute) => {
    // 예모님 지적(2026-08-28, P1): 화면에서 기존 후보를 선택할 때도 TTL을 확인하지 않고
    // POST /api/trips를 호출하고 있었다. 검색 후 5분이 지난 후보는 사용하지 않고,
    // 대신 다시 검색해야 한다는 안내와 함께 노선 목록 화면에 머무른다(재검색 자체는
    // 사용자가 음성으로 다시 목적지를 말하거나, Realtime 쪽에서 재검색을 유도한다).
    if (isRouteCandidatesExpired(routeCandidatesExpiresAt)) {
      navigation.navigate('Main');
      return;
    }

    setLoading(true);

    try {
      // A 취소 직후 후보 화면이 먼저 열려도, A의 실제 스캔 중지가 끝나기 전에는
      // B 운행과 새 대상 비콘 설정을 시작하지 않는다. RidingScreen의 cleanup과
      // 동시에 호출돼도 stopBeaconScan() single-flight가 같은 Promise를 공유한다.
      if (state.beaconScanActive) {
        await stopBeaconScan();
        dispatch({
          type: 'SET_BEACON_SCAN_ACTIVE',
          active: false,
        });
      }

      dispatch({
        type: 'SELECT_ROUTE',
        route: selectedRoute,
      });

      // 공통 API 명세서 5.2 기준 필드만 전달 (guideMessage·recommendationReason 등
      // 스펙에 없는 필드는 보내지 않는다 — 백엔드 스키마 검증 대상이 아님)
      const tripRequest = {
        destination:
          destination || selectedRoute.destinationStation?.stationName,
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

      dispatch({
        type: 'START_TRIP',
        tripId: data.tripId,
      });

      navigation.navigate('Riding', {
        tripId: data.tripId,
        selectedRoute,
      });
    } catch (error) {
      // errorCode별 분기 (13.2)
      if (
        error instanceof ApiError &&
        error.errorCode === 'INVALID_STATION_LIST'
      ) {
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
        <ActivityIndicator size="large" color="#FFD400" />
        <Text style={{ marginTop: 20, color: '#FFFFFF' }}>운행을 준비하는 중...</Text>
      </View>
    );
  }

  // 노선 없을 때 처리
  if (!visibleRouteCandidates || visibleRouteCandidates.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          이용 가능한 노선이 없습니다.
        </Text>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.navigate('Main')}
        >
          <Text style={styles.backButtonText}>처음으로</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={visibleRouteCandidates}
        keyExtractor={(item) => String(item.candidateId)}
        renderItem={({ item, index }) => {
          // 카드마다 강조색을 번갈아 사용 — 텍스트/기능은 그대로, 시각적 구분만 추가
          const accentColor = index % 2 === 0 ? '#FFD400' : '#2F8FFF';

          return (
            <TouchableOpacity
              style={[styles.routeCard, { borderColor: accentColor }]}
              onPress={() => selectRoute(item)}
            >
              <View style={[styles.routeAccentBar, { backgroundColor: accentColor }]} />
              <View style={styles.routeCardContent}>
                <Text style={styles.routeNo}>
                  {item.routeNo}번
                </Text>

                <Text style={styles.routeInfo}>
                  탑승 정류장: {item.boardingStation.stationName}
                </Text>

                <Text style={styles.routeInfo}>
                  하차 정류장: {item.destinationStation.stationName}
                </Text>

                {item.totalTime && (
                  <Text style={styles.routeInfo}>
                    예상 소요 시간: {item.totalTime}분
                  </Text>
                )}

                {item.recommendationReason && (
                  <Text style={[styles.routeReason, { color: accentColor }]}>
                    {item.recommendationReason}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0C10',
    padding: 20,
  },

  routeCard: {
    flexDirection: 'row',
    backgroundColor: '#15181F',
    borderRadius: 18,
    marginBottom: 16,
    borderWidth: 2,
    overflow: 'hidden',
  },

  routeAccentBar: {
    width: 6,
  },

  routeCardContent: {
    flex: 1,
    padding: 20,
  },

  routeNo: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 10,
  },

  routeInfo: {
    fontSize: 15,
    lineHeight: 22,
    color: '#B8BFC9',
    marginBottom: 4,
  },

  routeReason: {
    fontSize: 14,
    marginTop: 8,
    fontWeight: '700',
    fontStyle: 'italic',
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0C10',
    padding: 20,
  },

  emptyText: {
    fontSize: 18,
    color: '#B8BFC9',
    marginBottom: 30,
    textAlign: 'center',
  },

  backButton: {
    backgroundColor: '#FFC400',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    width: 200,
  },

  backButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: 'bold',
  },
});