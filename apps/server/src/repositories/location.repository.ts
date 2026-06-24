import type { LocationUpdate, TripId } from "@bus-ta/shared";

/** location_logs 테이블 접근 인터페이스 */
export interface LocationRepository {
  /** requestId 기준으로 중복 여부 확인 */
  isDuplicate(requestId: string): Promise<boolean>;
  save(data: LocationUpdate): Promise<void>;
  findLatest(tripId: TripId): Promise<LocationUpdate | null>;
}

// TODO: Supabase 구현체 추가
