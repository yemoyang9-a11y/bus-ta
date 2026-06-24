/**
 * 시연 진행 제어 — mock 좌표 전송 순서 담당
 *
 * fixtures(demo-locations)에서 좌표를 가져와 순서대로 서버로 전송한다.
 * 서버가 좌표를 받아 정류장 계산을 수행한다.
 */
import { DEMO_LOCATION_SEQUENCE } from "@bus-ta/shared";
import { asTripId } from "@bus-ta/shared";
import { apiClient } from "../api/client.js";

export async function runDemoSequence(tripId: string, intervalMs = 3000): Promise<void> {
  const tid = asTripId(tripId);

  for (const loc of DEMO_LOCATION_SEQUENCE) {
    await apiClient.trips.updateStatus(tripId, {
      tripId: tid,
      ...loc,
    });
    // TODO: 실제 시연에서는 앱 상태(tripStatus)를 갱신 후 다음 좌표 전송
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
