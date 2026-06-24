import type { Trip, TripId, TripStatus } from "@bus-ta/shared";

/** trips, trip_status 테이블 접근 인터페이스 */
export interface TripRepository {
  findById(tripId: TripId): Promise<Trip | null>;
  create(data: Omit<Trip, "tripId" | "createdAt" | "updatedAt">): Promise<Trip>;
  update(tripId: TripId, patch: Partial<Trip>): Promise<Trip>;
  updateStatus(tripId: TripId, status: TripStatus): Promise<void>;
}

// TODO: Supabase 구현체 추가 (apps/server/src/repositories/supabase/trip.repository.ts)
