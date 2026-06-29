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
}
