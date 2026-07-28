/**
 * 시연용 mock GPS 좌표 시퀀스 단일 출처
 *
 * apps/mobile/src/demo (또는 백엔드 데모 스크립트)에서 이 순서대로 3초 간격으로 서버에 전송한다.
 * 서버(apps/server/src/services/trip)는 전달받은 좌표로 정류장을 계산한다.
 *
 * 1551 노선(수원대학교 → 병점역후문)의 각 정류장 좌표를 sequence 순서대로 보낸다.
 * - 마지막에서 두 번째 좌표(sequence 9 "진안5통.병점육교")에서 remainingStations=1 이 되어
 *   하차벨(STOP_REQUEST)이 자동 생성된다.
 * - 마지막 좌표(sequence 10 "병점역후문")에서 remainingStations=0, tripStatus=TRIP_DONE.
 */
import type { LocationUpdate } from "../types/location.js";
import { asRequestId } from "../types/ids.js";

/** tripId는 런타임에 채워 넣으므로 placeholder 사용 */
const PLACEHOLDER_TRIP_ID = "FILL_AT_RUNTIME" as const;

export const DEMO_LOCATION_SEQUENCE: Omit<LocationUpdate, "tripId">[] = [
  { requestId: asRequestId("demo-loc-00"), latitude: 37.213789, longitude: 126.979772, recordedAt: "2026-07-01T09:00:00.000Z", source: "MOCK" },
  { requestId: asRequestId("demo-loc-01"), latitude: 37.211553, longitude: 126.983813, recordedAt: "2026-07-01T09:00:03.000Z", source: "MOCK" },
  { requestId: asRequestId("demo-loc-02"), latitude: 37.207917, longitude: 126.987467, recordedAt: "2026-07-01T09:00:06.000Z", source: "MOCK" },
  { requestId: asRequestId("demo-loc-03"), latitude: 37.206768, longitude: 126.988969, recordedAt: "2026-07-01T09:00:09.000Z", source: "MOCK" },
  { requestId: asRequestId("demo-loc-04"), latitude: 37.201489, longitude: 127.003042, recordedAt: "2026-07-01T09:00:12.000Z", source: "MOCK" },
  { requestId: asRequestId("demo-loc-05"), latitude: 37.199896, longitude: 127.008616, recordedAt: "2026-07-01T09:00:15.000Z", source: "MOCK" },
  { requestId: asRequestId("demo-loc-06"), latitude: 37.202668, longitude: 127.013649, recordedAt: "2026-07-01T09:00:18.000Z", source: "MOCK" },
  { requestId: asRequestId("demo-loc-07"), latitude: 37.205545, longitude: 127.017194, recordedAt: "2026-07-01T09:00:21.000Z", source: "MOCK" },
  { requestId: asRequestId("demo-loc-08"), latitude: 37.205397, longitude: 127.022232, recordedAt: "2026-07-01T09:00:24.000Z", source: "MOCK" },
  // sequence 9 — 목적지 전 정류장: 여기서 remainingStations=1 → STOP_REQUEST 자동 생성
  { requestId: asRequestId("demo-loc-09"), latitude: 37.208672, longitude: 127.03038, recordedAt: "2026-07-01T09:00:27.000Z", source: "MOCK" },
  // sequence 10 — 목적지 도착: remainingStations=0 → TRIP_DONE
  { requestId: asRequestId("demo-loc-10"), latitude: 37.20601, longitude: 127.032047, recordedAt: "2026-07-01T09:00:30.000Z", source: "MOCK" },
];

export { PLACEHOLDER_TRIP_ID };
