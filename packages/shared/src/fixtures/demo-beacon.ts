/**
 * 시연용 ESP32 비콘 데이터 단일 출처
 *
 * 비콘 ID 형식: BUSTA-{노선번호}-{정류장코드}
 * 자세한 규칙은 constants/beacon-id.ts 참고
 *
 * 1551은 기존 중간평가 시연 노선,
 * 35는 현재 실차 시연에서 사용하는 노선이다.
 *
 * 하드웨어 펌웨어가 실제로 광고하는 이름과 targetBeaconId가 반드시 같아야 한다.
 *
 * 2026-08-14:
 * 1551 mock 비콘을 실제 ESP32 이름
 * BUS_1551_001 / isMock: false 로 정렬했다.
 *
 * 2026-09-05:
 * 현재 실차 시연 노선 35의 실제 하차벨/비콘 이름
 * BUS_35_001을 fixture에도 추가한다.
 * Supabase DB 쪽은 별도 migration에서 같은 값을 ACTIVE 행으로 보장한다.
 */
import { asBeaconId } from "../types/ids.js";
import type { Beacon } from "../types/beacon.js";

export const DEMO_BEACONS: Beacon[] = [
  {
    beaconId: asBeaconId("BUSTA-1551-DEMO01"),
    routeNo: "1551",
    localBusId: "234001138",
    targetBeaconId: "BUS_1551_001",
    isMock: false,
  },
  {
    beaconId: asBeaconId("BUSTA-35-DEMO01"),
    routeNo: "35",
    targetBeaconId: "BUS_35_001",
    isMock: false,
  },
];