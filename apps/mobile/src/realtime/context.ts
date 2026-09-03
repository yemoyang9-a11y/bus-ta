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
 *
 * 예모님 지적(2026-08-28): 음성 end_trip(사용자 취소) 성공 시에도 이 함수가
 * 무조건 RESET_TRIP(전체 초기화)만 호출하고 있어서, destination·routeCandidates까지
 * 함께 사라지고 있었다. 화면 터치로 취소했을 때(RidingScreen.js)는 RESET_TRIP_KEEP_SEARCH를
 * 쓰고 있는 것과 계약이 어긋났다. keepSearch가 true면(사용자 취소) 검색 결과를 보존하는
 * RESET_TRIP_KEEP_SEARCH를, 그 외(TRIP_DONE·TRIP_NOT_FOUND 등 정상 종료·오류)에는
 * 기존처럼 RESET_TRIP(전체 초기화)을 사용한다.
 */
export function clearActiveTripContext(
  context: RealtimeGuideContext,
  keepSearch = false,
) {
  context.dispatchAppAction({
    type: keepSearch ? "RESET_TRIP_KEEP_SEARCH" : "RESET_TRIP",
  });
}