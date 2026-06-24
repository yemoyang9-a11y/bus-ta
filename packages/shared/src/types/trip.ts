import type { TripId, RouteId, StationId } from "./ids.js";
import type { TripStatus } from "../constants/trip-status.js";
import type { Station } from "./station.js";

export interface Trip {
  tripId: TripId;
  routeId: RouteId;
  boardingStationId: StationId;
  alightingStationId: StationId;
  status: TripStatus;
  /** 현재 가장 가까운 정류장 */
  currentStation: Station | null;
  /** 다음 정류장 */
  nextStation: Station | null;
  /** 목적지까지 남은 정류장 수 */
  remainingStops: number;
  createdAt: string;
  updatedAt: string;
}
