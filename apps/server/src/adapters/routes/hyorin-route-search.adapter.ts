import axios from "axios";
import type { Route, RoutesSearchRequest } from "@bus-ta/shared";

// ─────────────────────────────────────────────
// STEP 1. 카카오 Geocoding: 목적지 텍스트 → 좌표
// ─────────────────────────────────────────────
async function getDestinationCoords(destinationText: string) {
  const url = "https://dapi.kakao.com/v2/local/search/keyword.json";
  const res = await axios.get(url, {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    params: { query: destinationText },
  });
  const place = res.data.documents[0];
  if (!place) throw new Error(`목적지를 찾을 수 없습니다: ${destinationText}`);
  return {
    latitude: parseFloat(place.y),
    longitude: parseFloat(place.x),
  };
}

// ─────────────────────────────────────────────
// STEP 2. ODsay 경로탐색: 출발지·목적지 좌표 → 경로 후보
// pathType: 1=지하철, 2=버스, 3=버스+지하철 혼합
// trafficType (subPath): 1=지하철, 2=버스, 3=도보
// ─────────────────────────────────────────────
async function searchODsayRoutes(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
) {
  const url = "https://api.odsay.com/v1/api/searchPubTransPathT";
  const res = await axios.get(url, {
    params: {
      SX: originLng,
      SY: originLat,
      EX: destLng,
      EY: destLat,
      apiKey: process.env.ODSAY_API_KEY,
    },
  });
  if (!res.data.result) return [];
  return res.data.result.path || [];
}

// ─────────────────────────────────────────────
// 유틸: 두 좌표 사이 거리 계산 (km)
// ─────────────────────────────────────────────
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = (lat2 - lat1) * 111;
  const dLng = (lng2 - lng1) * 88;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ─────────────────────────────────────────────
// 노선 검색 adapter (효린 담당)
// mockSearchRoutes 와 동일 시그니처로 교체
// ─────────────────────────────────────────────
export async function searchRoutes(request: RoutesSearchRequest): Promise<Route[]> {
  const { destination, latitude, longitude } = request;

  const destCoords = await getDestinationCoords(destination);
  const paths = await searchODsayRoutes(latitude, longitude, destCoords.latitude, destCoords.longitude);

  if (!paths || paths.length === 0) return [];

  const candidates: Route[] = [];
  let candidateId = 1;

  for (const path of paths) {
    // 버스 구간만 추출 (trafficType 2 = 버스)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const busSubPaths = (path.subPath || []).filter((sp: any) => sp.trafficType === 2);

    // MVP: 환승 없는 직행 버스 경로만 처리
    if (busSubPaths.length !== 1) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subPath = busSubPaths[0] as any;

    const stations = subPath.passStopList?.stations || [];
    if (stations.length < 2) continue;

    // subPath 하나를 여러 버스 노선이 공유할 수 있다 (같은 도로 구간을 지나는 버스들).
    // lane[0]만 쓰면 나머지 노선이 후보에서 통째로 빠지므로, lane 전체를 순회해
    // 노선마다 별도 후보를 만든다. 정류장 정보는 subPath 공통이라 그대로 공유한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lanes = (subPath.lane ?? []) as any[];
    if (lanes.length === 0) continue;

    // ODsay startLocalStationID = GBIS stationId (테스트로 동일 확인, 역조회 불필요)
    const gbisStationId = String(subPath.startLocalStationID ?? "");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stationList = stations.map((s: any, i: number) => ({
      stationName: s.stationName as string,
      latitude: parseFloat(s.y),
      longitude: parseFloat(s.x),
      sequence: i,
    }));

    const boardingStation = {
      stationName: subPath.startName as string,
      latitude: parseFloat(stations[0].y),
      longitude: parseFloat(stations[0].x),
    };
    const destinationStation = {
      stationName: stations[stations.length - 1].stationName as string,
      latitude: parseFloat(stations[stations.length - 1].y),
      longitude: parseFloat(stations[stations.length - 1].x),
    };

    // 하차 정류장이 목적지에서 0.7km 초과 시 제외 (subPath 공통 조건이라 노선과 무관하게 한 번만 검사)
    const dist = distanceKm(
      destinationStation.latitude,
      destinationStation.longitude,
      destCoords.latitude,
      destCoords.longitude,
    );
    if (dist > 0.7) continue;

    const info = path.info ?? {};

    for (const lane of lanes) {
      const routeNo = String(lane.busNo ?? "");
      const localBusId = String(lane.busLocalBlID ?? "");

      candidates.push({
        candidateId: candidateId++,
        routeNo,
        localBusId,
        gbisStationId,
        boardingStation,
        destinationStation,
        stationList,
        totalTime: info.totalTime ?? undefined,
        totalWalk: info.totalWalk ?? undefined,
        payment: info.payment ?? undefined,
        busTransitCount: info.busTransitCount ?? undefined,
        busStationCount: subPath.stationCount ?? undefined,
        totalDistance: info.totalDistance ?? undefined,
        intervalTime: subPath.intervalTime ?? undefined,
      });
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────
// GBIS 실시간 도착정보 조회
// ─────────────────────────────────────────────
async function getBusArrivalByStationId(gbisStationId: string) {
  const url = "https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2";
  const res = await axios.get(url, {
    params: {
      serviceKey: process.env.GBIS_SERVICE_KEY,
      stationId: gbisStationId,
      _type: "json",
    },
  });
  const items = res.data?.response?.msgBody?.busArrivalList;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// ─────────────────────────────────────────────
// 도착 예정 시간 조회 adapter (효린 담당)
// selectedCandidate: searchRoutes()가 반환한 Route 객체 중 사용자가 선택한 것
// 반환: { gbisStationId, localBusId, predictedArrivalMinutes }
// ─────────────────────────────────────────────
export async function getArrivalInfo(
  selectedCandidate: Pick<Route, "gbisStationId" | "localBusId">,
): Promise<{ gbisStationId: string; localBusId: string; predictedArrivalMinutes: number | null }> {
  const { gbisStationId, localBusId } = selectedCandidate;

  // ODsay startLocalStationID = GBIS stationId (테스트로 동일 확인, 역조회 불필요)
  const arrivals = await getBusArrivalByStationId(gbisStationId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matched = arrivals.find((a: any) => String(a.routeId) === String(localBusId));

  if (matched) {
    const parsed = parseInt(matched.predictTime1, 10);
    return {
      gbisStationId,
      localBusId,
      predictedArrivalMinutes: Number.isNaN(parsed) ? null : parsed,
    };
  }

  return { gbisStationId, localBusId, predictedArrivalMinutes: null };
}
