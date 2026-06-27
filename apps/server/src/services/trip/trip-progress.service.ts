import type { StationListItem } from "@bus-ta/shared";

export interface NearestStationResult {
  currentStation: StationListItem;
  nextStation: StationListItem | null;
  remainingStations: number;
}

/**
 * 전달받은 좌표로 현재·다음·남은 정류장을 계산한다.
 * 실제 구현 시 haversine 거리 계산을 사용한다.
 */
export function calcNearestStation(
  latitude: number,
  longitude: number,
  stations: StationListItem[],
  destinationStationIndex = stations.length - 1,
): NearestStationResult | null {
  if (stations.length === 0) return null;

  let currentIndex = 0;
  let currentDistance = Number.POSITIVE_INFINITY;

  stations.forEach((station, index) => {
    const distance = Math.hypot(station.latitude - latitude, station.longitude - longitude);
    if (distance < currentDistance) {
      currentDistance = distance;
      currentIndex = index;
    }
  });

  const current = stations[currentIndex];
  if (!current) return null;

  const nextStation = stations[currentIndex + 1] ?? null;
  const remainingStations = Math.max(0, destinationStationIndex - currentIndex);

  return { currentStation: current, nextStation, remainingStations };
}
