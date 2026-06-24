import type { BeaconId, RouteId, StationId } from "./ids.js";

export interface Beacon {
  beaconId: BeaconId;
  routeId: RouteId;
  /** 비콘이 장착된 버스의 현재 정류장 (null이면 알 수 없음) */
  currentStationId: StationId | null;
  routeNo: string;
  lastSeenAt: string | null;
}
