import type { BellState, BellRequest, BellResult, TripId } from "@bus-ta/shared";

/** bell_logs 테이블 접근 인터페이스 */
export interface BellRepository {
  findState(tripId: TripId): Promise<BellState | null>;
  createRequest(data: BellRequest): Promise<void>;
  updateResult(data: BellResult): Promise<void>;
}

// TODO: Supabase 구현체 추가
