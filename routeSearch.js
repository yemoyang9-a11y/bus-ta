// 효린 담당: 지도·버스 API 모듈
// 카카오 Geocoding → ODsay 경로탐색 → GBIS 실시간 도착정보 순서로 호출
// 예모 백엔드에서 searchRoutes(destination, latitude, longitude) 로 호출

const axios = require("axios");
require("dotenv").config();

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
const GBIS_KEY  = process.env.GBIS_SERVICE_KEY;
const ODSAY_KEY = process.env.ODSAY_API_KEY;

// ─────────────────────────────────────────────
// STEP 1. 카카오 Geocoding: 목적지 텍스트 → 좌표
// ─────────────────────────────────────────────
async function getDestinationCoords(destinationText) {
  const url = "https://dapi.kakao.com/v2/local/search/keyword.json";
  const res = await axios.get(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    params: { query: destinationText },
  });

  const place = res.data.documents[0];
  if (!place) throw new Error(`목적지를 찾을 수 없습니다: ${destinationText}`);

  return {
    name: place.place_name,
    latitude: parseFloat(place.y),
    longitude: parseFloat(place.x),
  };
}

// ─────────────────────────────────────────────
// STEP 2. ODsay 경로탐색: 출발지·목적지 좌표 → 경로 후보
// pathType: 1=지하철 경로, 2=버스 경로, 3=버스+지하철 혼합 경로
// trafficType (subPath): 1=지하철, 2=버스, 3=도보
// ─────────────────────────────────────────────
async function searchODsayRoutes(originLat, originLng, destLat, destLng) {
  const url = "https://api.odsay.com/v1/api/searchPubTransPathT";
  const res = await axios.get(url, {
    params: {
      SX: originLng,
      SY: originLat,
      EX: destLng,
      EY: destLat,
      apiKey: ODSAY_KEY,
    },
  });

  if (!res.data.result) return [];
  return res.data.result.path || [];
}

// ─────────────────────────────────────────────
// 유틸: 두 좌표 사이 거리 계산 (km)
// ─────────────────────────────────────────────
function distanceKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * 111;
  const dLng = (lng2 - lng1) * 88;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ─────────────────────────────────────────────
// STEP 3. GBIS 실시간 도착정보: gbisStationId → 도착 예정 시간
// ─────────────────────────────────────────────
async function getBusArrivalByStationId(gbisStationId) {
  const url = "https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2";
  const res = await axios.get(url, {
    params: {
      serviceKey: GBIS_KEY,
      stationId: gbisStationId,
      _type: "json",
    },
  });

  const items = res.data?.response?.msgBody?.busArrivalList;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// ─────────────────────────────────────────────
// 1단계: 경로 후보 요약 반환 (유나 AI 비교용)
// 예모 백엔드에서 searchRoutes(destination, latitude, longitude) 로 호출
//
// [반환값 - candidates 배열]
// candidateId       : 후보 식별자 (순번)
// routeNo           : 버스 번호 (예: "700-2")
// localBusId        : ODsay busLocalBlID = GBIS routeId 형식 (예: "234000021")
// gbisStationId     : ODsay startLocalStationID = GBIS stationId (예: "201000166")
// boardingStation   : 탑승 정류장 정보 { stationName, latitude, longitude }
// destinationStation: 하차 정류장 정보 { stationName, latitude, longitude }
// totalTime         : 전체 소요시간 (분)
// totalWalk         : 총 도보 거리 (m)
// payment           : 요금 (원)
// busTransitCount   : ODsay 기준 버스 이용 구간 수 (환승 횟수와 다름, 직행도 1로 반환)
// busStationCount   : 버스 정류장 수
// totalDistance     : 전체 이동 거리 (m)
// intervalTime      : 배차 간격 (분)
// ─────────────────────────────────────────────
async function searchRoutes(destination, latitude, longitude) {
  try {
    // 1. 목적지 좌표 변환
    const destCoords = await getDestinationCoords(destination);

    // 2. ODsay 경로탐색 (버스/혼합 경로 후보 전체)
    const paths = await searchODsayRoutes(latitude, longitude, destCoords.latitude, destCoords.longitude);

    if (!paths || paths.length === 0) {
      return { candidates: [], error: "이용 가능한 경로를 찾을 수 없습니다." };
    }

    // 3. 후보 요약정보 추출
    const candidates = [];
    let candidateId = 1;

    for (const path of paths) {
      // 버스 구간만 추출 (trafficType 2 = 버스)
      const busSubPaths = (path.subPath || []).filter((sp) => sp.trafficType === 2);

      // MVP: 환승 없는 직행 버스 경로만 처리
      if (busSubPaths.length !== 1) continue;
      const subPath = busSubPaths[0];

      const stations = subPath.passStopList?.stations || [];
      if (stations.length < 2) continue;

      const lane = subPath.lane?.[0] ?? {};
      const routeNo    = String(lane.busNo ?? "");
      const localBusId = String(lane.busLocalBlID ?? "");  // GBIS routeId 형식

      // ODsay startLocalStationID = GBIS stationId (직접 사용 가능, 역조회 불필요)
      const gbisStationId = String(subPath.startLocalStationID ?? "");

      const stationList = stations.map((s, i) => ({
        stationName: s.stationName,
        latitude: parseFloat(s.y),
        longitude: parseFloat(s.x),
        sequence: i,
      }));

      const boardingStation = {
        stationName: subPath.startName,
        latitude: parseFloat(stations[0].y),
        longitude: parseFloat(stations[0].x),
      };
      const destinationStation = {
        stationName: stations[stations.length - 1].stationName,
        latitude: parseFloat(stations[stations.length - 1].y),
        longitude: parseFloat(stations[stations.length - 1].x),
      };

      // 하차 정류장이 목적지에서 0.7km 초과 시 제외
      const dist = distanceKm(
        destinationStation.latitude, destinationStation.longitude,
        destCoords.latitude, destCoords.longitude
      );
      if (dist > 0.7) continue;

      const info = path.info ?? {};

      candidates.push({
        candidateId: candidateId++,
        routeNo,
        localBusId,
        gbisStationId,
        boardingStation,
        destinationStation,
        stationList,
        totalTime:       info.totalTime       ?? null,
        totalWalk:       info.totalWalk       ?? null,
        payment:         info.payment         ?? null,
        busTransitCount: info.busTransitCount ?? null,
        busStationCount: subPath.stationCount ?? null,
        totalDistance:   info.totalDistance   ?? null,
        intervalTime:    subPath.intervalTime ?? null,
      });
    }

    return { candidates };
  } catch (err) {
    console.error("[searchRoutes 오류]", err.message);

    // API 오류 시 mock 응답 반환 (시연용)
    return {
      candidates: [
        {
          candidateId: 1,
          routeNo: "700-2",
          localBusId: "234000021",
          gbisStationId: "201000166",
          boardingStation: {
            stationName: "오목천역.영신여자고교.청구아파트",
            latitude: 37.242027,
            longitude: 126.962801,
          },
          destinationStation: {
            stationName: "수원대학교",
            latitude: 37.213789,
            longitude: 126.979749,
          },
          stationList: [
            { stationName: "오목천역.영신여자고교.청구아파트", latitude: 37.242027, longitude: 126.962801, sequence: 0 },
            { stationName: "수영오거리.방송통신대입구", latitude: 37.237447, longitude: 126.962515, sequence: 1 },
            { stationName: "수원대학교", latitude: 37.213789, longitude: 126.979749, sequence: 10 },
          ],
          totalTime: 25,
          totalWalk: 120,
          payment: 1500,
          busTransitCount: 1,
          busStationCount: 11,
          totalDistance: 8200,
          intervalTime: 15,
        },
      ],
      isMock: true,
    };
  }
}

// ─────────────────────────────────────────────
// 2단계: 사용자가 최종 노선 선택 후 호출
// 예모 백엔드에서 getArrivalInfo(selectedCandidate) 로 호출
//
// [입력값]
// selectedCandidate.gbisStationId : ODsay startLocalStationID (= GBIS stationId)
// selectedCandidate.localBusId    : ODsay busLocalBlID (= GBIS routeId)
//
// [반환값]
// gbisStationId          : GBIS 정류장 ID (탑승 후 실시간 체크에 사용 예정)
// localBusId             : GBIS routeId
// predictedArrivalMinutes: 버스 도착 예정 시간 (분), 조회 실패 시 null
//
// TODO: 탑승 후 실시간 버스 위치 체크 구현 필요 (중간평가 이후)
// ─────────────────────────────────────────────
async function getArrivalInfo(selectedCandidate) {
  const { gbisStationId, localBusId } = selectedCandidate;

  try {
    // ODsay startLocalStationID를 GBIS stationId로 직접 사용 (역조회 불필요)
    const arrivals = await getBusArrivalByStationId(gbisStationId);
    const matched = arrivals.find((a) => String(a.routeId) === String(localBusId));

    if (matched) {
      const parsed = parseInt(matched.predictTime1, 10);
      return {
        gbisStationId,
        localBusId,
        predictedArrivalMinutes: Number.isNaN(parsed) ? null : parsed,
      };
    }

    return { gbisStationId, localBusId, predictedArrivalMinutes: null };
  } catch (err) {
    console.error("[getArrivalInfo 오류]", err.message);
    return { gbisStationId: null, localBusId: null, predictedArrivalMinutes: null };
  }
}

module.exports = { searchRoutes, getArrivalInfo };
