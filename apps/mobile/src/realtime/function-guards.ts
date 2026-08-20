/**
 * Realtime 모델이 전달한 tripId를 그대로 신뢰하지 않고,
 * create_trip 성공 후 앱 상태에 저장된 현재 운행 ID와 대조한다.
 */
export function assertActiveTripId(
  requestedTripId: unknown,
  activeTripId: string | null,
): string {
  if (typeof requestedTripId !== "string" || requestedTripId.trim().length === 0) {
    throw new Error("tripId 값이 필요합니다.");
  }

  if (!activeTripId) {
    throw new Error("진행 중인 운행이 없습니다. 먼저 운행을 생성해 주세요.");
  }

  if (requestedTripId !== activeTripId) {
    throw new Error("요청한 운행 ID가 현재 진행 중인 운행과 일치하지 않습니다.");
  }

  return activeTripId;
}
