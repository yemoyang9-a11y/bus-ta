/**
 * ESP32 버스 비콘 식별자 네임스페이스 규칙
 *
 * 형식: BUSTA-{노선번호}-{정류장코드}
 * 예시: BUSTA-360-23012340
 *
 * 시연용 비콘 ID는 packages/shared/src/fixtures/demo-beacon.ts 참고
 */
export const BEACON_ID_PREFIX = "BUSTA" as const;

export const BEACON_ID_SEPARATOR = "-" as const;

export function makeBeaconId(routeNo: string, stationCode: string): string {
  return `${BEACON_ID_PREFIX}${BEACON_ID_SEPARATOR}${routeNo}${BEACON_ID_SEPARATOR}${stationCode}`;
}
