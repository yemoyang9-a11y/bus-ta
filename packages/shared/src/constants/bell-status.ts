export const BELL_STATUS = {
  NOT_REQUESTED: "NOT_REQUESTED",
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAIL: "FAIL",
} as const;

export type BellStatus = (typeof BELL_STATUS)[keyof typeof BELL_STATUS];

/**
 * 상태 전환 책임:
 * - GET   /trips/{tripId}/status      → 조회 전용, 상태 변경 없음
 * - PATCH /trips/{tripId}/status      → remainingStations=1 & NOT_REQUESTED 감지 시 자동으로 PENDING 생성
 * - POST  /trips/{tripId}/bell/result → PENDING → SUCCESS | FAIL
 */
export const BELL_RETRYABLE_STATUSES: readonly BellStatus[] = [
  BELL_STATUS.NOT_REQUESTED,
  BELL_STATUS.FAIL,
] as const;
