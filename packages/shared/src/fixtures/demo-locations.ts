/**
 * 시연용 mock GPS 좌표 시퀀스 단일 출처
 *
 * apps/mobile/src/demo 에서 이 순서대로 서버로 전송한다.
 * 서버(apps/server/src/services/trip)는 전달받은 좌표로 정류장을 계산한다.
 */
import type { LocationUpdate } from "../types/location.js";
import { asRequestId } from "../types/ids.js";

/** tripId는 런타임에 채워 넣으므로 placeholder 사용 */
const PLACEHOLDER_TRIP_ID = "FILL_AT_RUNTIME" as const;

export const DEMO_LOCATION_SEQUENCE: Omit<LocationUpdate, "tripId">[] = [
  {
    requestId: asRequestId("demo-loc-01"),
    lat: 37.4901,
    lng: 127.0301,
    timestamp: "2024-01-01T09:00:00.000Z",
  },
  {
    requestId: asRequestId("demo-loc-02"),
    lat: 37.4921,
    lng: 127.0321,
    timestamp: "2024-01-01T09:02:00.000Z",
  },
  {
    requestId: asRequestId("demo-loc-03"),
    lat: 37.4941,
    lng: 127.0341,
    timestamp: "2024-01-01T09:04:00.000Z",
  },
  {
    requestId: asRequestId("demo-loc-04"),
    lat: 37.4958,
    lng: 127.0358,
    timestamp: "2024-01-01T09:06:00.000Z",
  },
];

export { PLACEHOLDER_TRIP_ID };
