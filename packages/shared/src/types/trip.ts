import type { TripId, BellRequestId } from "./ids.js";
import type { TripStatus } from "../constants/trip-status.js";
import type { Station } from "./station.js";
import type { BellCommand } from "../constants/bell-command.js";
import type { BellStatus } from "../constants/bell-status.js";

export interface Trip {
  tripId: TripId;
  destination: string;
  routeNo: string;
  localBusId: string;
  gbisStationId: string;
  tripStatus: TripStatus;
  bellStatus: BellStatus;
  boardingStation: Station;
  destinationStation: Station;
  currentStation: Station | null;
  nextStation: Station | null;
  remainingStations: number;
  bellRequestId?: BellRequestId;
  command?: BellCommand | null;
  createdAt: string;
  updatedAt: string;
}
