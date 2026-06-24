import type { Station } from "@bus-ta/shared";

export interface NearestStationResult {
  currentStation: Station;
  nextStation: Station | null;
  remainingStops: number;
}

/**
 * 전달받은 좌표로 현재·다음·남은 정류장을 계산한다.
 * 실제 구현 시 haversine 거리 계산을 사용한다.
 */
export function calcNearestStation(
  lat: number,
  lng: number,
  stations: Station[],
  alightingStationSequence: number,
): NearestStationResult | null {
  if (stations.length === 0) return null;

  // TODO: haversine 거리 기반 가장 가까운 정류장 찾기
  const sorted = [...stations].sort((a, b) => {
    const dA = Math.hypot(a.lat - lat, a.lng - lng);
    const dB = Math.hypot(b.lat - lat, b.lng - lng);
    return dA - dB;
  });

  const current = sorted[0];
  if (!current) return null;

  const nextSeq = current.sequence + 1;
  const nextStation = stations.find((s) => s.sequence === nextSeq) ?? null;
  const remainingStops = Math.max(0, alightingStationSequence - current.sequence);

  return { currentStation: current, nextStation, remainingStops };
}
