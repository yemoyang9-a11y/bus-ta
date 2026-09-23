import type { Station, StationListItem } from "./station.js";

export type RouteMode = "DIRECT_BUS" | "MULTIMODAL";
export type RouteSegmentMode = "WALK" | "BUS" | "SUBWAY";

export interface RouteSegment {
  mode: RouteSegmentMode;
  startName: string;
  endName: string;
  lineNames: string[];
  routeNumbers: string[];
  stationCount?: number;
  sectionTime?: number;
}

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
  routeMode?: RouteMode;
  tripSupported?: boolean;
  segments?: RouteSegment[];
}
