import type { ArrivalInfo } from "../schemas/arrival.schema.js";
import type { Station, StationListItem } from "./station.js";

export interface Route {
  candidateId: number;
  routeNo: string;
  localBusId: string;
  gbisStationId: string;
  boardingStation: Station;
  destinationStation: Station;
  stationList: StationListItem[];
  totalTime?: number;
  totalWalk?: number;
  payment?: number;
  busTransitCount?: number;
  busStationCount?: number;
  totalDistance?: number;
  intervalTime?: number;
  recommendationReason?: string;
  guideMessage?: string;
  /**
   * 검색 시점의 도착 예정 차량(최대 2대). 사용자가 노선을 고르기 전에도 도착
   * 시간을 안내하기 위한 값이다. 조회에 실패했거나 실시간 차량이 없으면 없다.
   * 탑승 안내에 쓰는 값은 POST /api/trips 응답의 arrivals 를 다시 사용한다.
   */
  arrivals?: ArrivalInfo[];
}
