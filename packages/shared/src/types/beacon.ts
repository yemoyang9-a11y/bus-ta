import type { BeaconId } from "./ids.js";

export interface Beacon {
  beaconId: BeaconId;
  routeNo: string;
  localBusId?: string;
  vehicleId?: string;
  targetBeaconId: string;
  isMock: boolean;
}
