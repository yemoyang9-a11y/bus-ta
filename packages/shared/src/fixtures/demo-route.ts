/**
 * 시연용 노선 + 정류장 시퀀스 단일 출처
 *
 * 모든 시연 시나리오에서 이 데이터를 기반으로 한다.
 * 실제 GBIS API 데이터 수신 후 이 파일로 업데이트한다.
 */
import type { Route } from "../types/route.js";

export const DEMO_ROUTE: Route = {
  candidateId: 1,
  routeNo: "360",
  localBusId: "demo-local-bus-360",
  gbisStationId: "demo-gbis-station-01",
  boardingStation: {
    stationName: "출발정류장 (시연)",
    latitude: 37.49,
    longitude: 127.03,
  },
  destinationStation: {
    stationName: "도착정류장 (시연)",
    latitude: 37.496,
    longitude: 127.036,
  },
  stationList: [
    {
      stationName: "출발정류장 (시연)",
      latitude: 37.49,
      longitude: 127.03,
      sequence: 0,
    },
    {
      stationName: "중간정류장1 (시연)",
      latitude: 37.492,
      longitude: 127.032,
      sequence: 1,
    },
    {
      stationName: "중간정류장2 (시연)",
      latitude: 37.494,
      longitude: 127.034,
      sequence: 2,
    },
    {
      stationName: "도착정류장 (시연)",
      latitude: 37.496,
      longitude: 127.036,
      sequence: 3,
    },
  ],
};

export const DEMO_BOARDING_STATION = DEMO_ROUTE.boardingStation;
export const DEMO_DESTINATION_STATION = DEMO_ROUTE.destinationStation;
