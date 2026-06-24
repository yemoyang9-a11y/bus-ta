import type { Beacon, BeaconId } from "@bus-ta/shared";

/** bus_beacons 테이블 접근 인터페이스 */
export interface BeaconRepository {
  findAll(): Promise<Beacon[]>;
  findById(beaconId: BeaconId): Promise<Beacon | null>;
}

// TODO: Supabase 구현체 추가
