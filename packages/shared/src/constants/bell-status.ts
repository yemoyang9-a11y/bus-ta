export const BELL_STATUS = {
  NOT_REQUESTED: "NOT_REQUESTED",
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAIL: "FAIL",
} as const;

export type BellStatus = (typeof BELL_STATUS)[keyof typeof BELL_STATUS];

/**
 * 상태 전환 책임:
 * - GET  /bell/request (상태 조회)  → 상태 변경 없음
 * - POST /bell/request              → NOT_REQUESTED | 재시도 가능한 FAIL → PENDING
 * - POST /bell/result               → PENDING → SUCCESS | FAIL
 */
export const BELL_RETRYABLE_STATUSES: readonly BellStatus[] = [
  BELL_STATUS.NOT_REQUESTED,
  BELL_STATUS.FAIL,
] as const;
