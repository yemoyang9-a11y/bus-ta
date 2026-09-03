import type { AppAction, AppTripState, RealtimeGuideContext } from "./types";

type CreateRealtimeGuideContextParams = {
  getAppState(): AppTripState;
  getCurrentLocation(): { latitude: number; longitude: number } | undefined;
  refreshCurrentLocation(): Promise<void>;
  dispatchAppAction(action: AppAction): void;
};

/**
 * TripContext(state/TripContext.js)와 연결된 RealtimeGuideContext를 만든다.
 * 운행 상태는 여기서 별도로 보관하지 않고, 매번 TripContext에서 읽고 쓴다.
 * (2026-08-12, 예모님 확정: TripContext를 운행 상태의 유일한 원본으로 사용)
 */
export function createRealtimeGuideContext(
  params: CreateRealtimeGuideContextParams,
): RealtimeGuideContext {
  return {
    getAppState: params.getAppState,
    getCurrentLocation: params.getCurrentLocation,
    refreshCurrentLocation: params.refreshCurrentLocation,
    dispatchAppAction: params.dispatchAppAction,
  };
}

/**
 * 현재 운행을 초기화한다. TripContext의 RESET_TRIP 액션을 통해 처리하며,
 * 이 함수는 그 액션을 대신 호출해 주는 얇은 래퍼다.
 */
export function clearActiveTripContext(context: RealtimeGuideContext) {
  context.dispatchAppAction({ type: "RESET_TRIP" });
}

/**
 * 현재 운행만 초기화하고 기존 검색 결과는 유지한다.
 * 사용자가 운행을 취소한 뒤 같은 검색 결과에서 다른 후보를 고를 때 사용한다.
 */
export function clearActiveTripContextKeepSearch(context: RealtimeGuideContext) {
  context.dispatchAppAction({ type: "RESET_TRIP_KEEP_SEARCH" });
}
