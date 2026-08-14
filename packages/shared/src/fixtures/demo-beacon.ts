/**
 * 시연용 ESP32 비콘 데이터 단일 출처
 *
 * 비콘 ID 형식: BUSTA-{노선번호}-{정류장코드}
 * 자세한 규칙은 constants/beacon-id.ts 참고
 *
 * 중간평가 시연 노선 1551 기준 비콘.
 * (하드웨어 펌웨어의 TARGET_BEACON_ID 도 같은 값으로 맞춰야 한다.)
 *
 * 2026-08-14: 정민 ESP32 펌웨어(beacon_bell.ino)가 실제로 광고하는 이름에 맞춰
 * MOCK_BUS_1551_001 / isMock: true 에서 BUS_1551_001 / isMock: false 로 정렬했다.
 * DB 쪽 대응 migration 은 supabase/migrations/20260814063714_align_demo_beacon_to_real_esp32.sql.
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
];
