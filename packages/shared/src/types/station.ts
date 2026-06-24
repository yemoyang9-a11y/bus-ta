import type { StationId, RouteId } from "./ids.js";

export interface Station {
  stationId: StationId;
  name: string;
  lat: number;
  lng: number;
  /** 노선 내 정류장 순번 (0-based) */
  sequence: number;
  routeId: RouteId;
}
