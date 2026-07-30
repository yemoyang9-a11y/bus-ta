/**
 * 시연용 노선 + 정류장 시퀀스 단일 출처
 *
 * 중간평가 시연 노선: 1551번 (수원대학교 → 병점역후문).
 * 효린 버스 API 모듈(ODsay/GBIS)에서 받아온 실제 노선 데이터를 기준으로 한다.
 * 하차 트리거 정류장: 목적지(병점역후문) 직전인 sequence 9 "진안5통.병점육교".
 */
import type { Route } from "../types/route.js";

export const DEMO_ROUTE: Route = {
  candidateId: 7,
  routeNo: "1551",
  localBusId: "234001138",
  gbisStationId: "233001214",
  boardingStation: {
    stationName: "수원대학교",
    latitude: 37.213789,
    longitude: 126.979772,
  },
  destinationStation: {
    stationName: "병점역후문",
    latitude: 37.20601,
    longitude: 127.032047,
  },
  stationList: [
    { stationName: "수원대학교", latitude: 37.213789, longitude: 126.979772, sequence: 0 },
    { stationName: "수원대학교", latitude: 37.211553, longitude: 126.983813, sequence: 1 },
    { stationName: "융건릉사거리", latitude: 37.207917, longitude: 126.987467, sequence: 2 },
    { stationName: "융건릉입구", latitude: 37.206768, longitude: 126.988969, sequence: 3 },
    { stationName: "중외제약사거리", latitude: 37.201489, longitude: 127.003042, sequence: 4 },
    { stationName: "신한미지엔아파트앞", latitude: 37.199896, longitude: 127.008616, sequence: 5 },
    { stationName: "북촌말입구", latitude: 37.202668, longitude: 127.013649, sequence: 6 },
    { stationName: "송산동입구", latitude: 37.205545, longitude: 127.017194, sequence: 7 },
    { stationName: "동문아파트", latitude: 37.205397, longitude: 127.022232, sequence: 8 },
    { stationName: "진안5통.병점육교", latitude: 37.208672, longitude: 127.03038, sequence: 9 },
    { stationName: "병점역후문", latitude: 37.20601, longitude: 127.032047, sequence: 10 },
  ],
  totalTime: 19,
  totalWalk: 134,
  payment: 3200,
  busTransitCount: 1,
  busStationCount: 9,
  totalDistance: 5879,
  intervalTime: 50,
};

export const DEMO_BOARDING_STATION = DEMO_ROUTE.boardingStation;
export const DEMO_DESTINATION_STATION = DEMO_ROUTE.destinationStation;
