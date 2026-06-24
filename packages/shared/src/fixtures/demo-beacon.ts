/**
 * 시연용 ESP32 비콘 데이터 단일 출처
 *
 * 비콘 ID 형식: BUSTA-{노선번호}-{정류장코드}
 * 자세한 규칙은 constants/beacon-id.ts 참고
 */
import { asBeaconId, asRouteId, asStationId } from "../types/ids.js";
import type { Beacon } from "../types/beacon.js";

export const DEMO_BEACONS: Beacon[] = [
  {
    beaconId: asBeaconId("BUSTA-360-DEMO01"),
    routeId: asRouteId("demo-route-360"),
    currentStationId: asStationId("demo-st-01"),
    routeNo: "360",
    lastSeenAt: null,
  },
];
