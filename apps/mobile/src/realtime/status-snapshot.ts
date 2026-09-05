import type { TripStatusSnapshot } from "./types";

/**
 * 서버 상태 응답을 Realtime 세션에 알릴 스냅샷으로 바꾼다.
 *
 * RidingScreen 의 GET /status 반복 조회와 3초 주기 PATCH /status 가 같은 형태로
 * 세션에 전달되도록 한 곳에서 만든다. dispatch 결과를 기다리지 않고 방금 받은
 * 응답을 그대로 넘기기 때문에, 여기서 값을 재계산하지 않는다.
 */
export function toTripStatusSnapshot(response: {
  tripStatus?: string | null;
  boardingMethod?: TripStatusSnapshot["boardingMethod"];
  boardingConfirmedAt?: string | null;
  remainingStations?: number | null;
  currentStation?: { stationName: string } | null;
  bellStatus?: string;
  guideMessage?: string | null;
  arrivals?: TripStatusSnapshot["arrivals"];
  arrivalStatus?: TripStatusSnapshot["arrivalStatus"];
  nextArrivalRefreshInMs?: number | null;
}): TripStatusSnapshot {
  return {
    tripStatus: response.tripStatus ?? null,
    boardingMethod: response.boardingMethod ?? null,
    boardingConfirmedAt: response.boardingConfirmedAt ?? null,
    remainingStations: response.remainingStations ?? null,
    currentStation: response.currentStation ?? null,
    bellStatus: response.bellStatus ?? "NOT_REQUESTED",
    guideMessage: response.guideMessage ?? null,
    // 도착정보는 대기 중 GET /status 응답에만 있다. 없는 응답에서 굳이 null 을
    // 만들어 넣으면 "지금 확인해 보니 값이 없다"와 구분되지 않는다. 그대로 비워
    // 두고, 직전 값을 이어 받을지는 event-dispatcher 가 판단한다.
    ...(response.arrivalStatus !== undefined ? { arrivalStatus: response.arrivalStatus } : {}),
    ...(response.arrivals !== undefined ? { arrivals: response.arrivals } : {}),
    ...(response.nextArrivalRefreshInMs !== undefined
      ? { nextArrivalRefreshInMs: response.nextArrivalRefreshInMs }
      : {}),
  };
}
