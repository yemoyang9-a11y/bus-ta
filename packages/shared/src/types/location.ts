import type { TripId, RequestId } from "./ids.js";

export interface LocationUpdate {
  tripId: TripId;
  /**
   * GPS 또는 mock 위치 업데이트의 중복 요청 판정 전용.
   * bellRequestId 와 혼용 금지.
   */
  requestId: RequestId;
  latitude: number;
  longitude: number;
  recordedAt: string;
  source: "GPS" | "MOCK" | "MANUAL";
}
