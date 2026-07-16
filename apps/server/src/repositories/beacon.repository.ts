import { DEMO_BEACONS } from "@bus-ta/shared";
import type { Beacon, BeaconId } from "@bus-ta/shared";

/** bus_beacons 테이블 접근 인터페이스 */
export interface BeaconRepository {
  findAll(): Promise<Beacon[]>;
  findById(beaconId: BeaconId): Promise<Beacon | null>;
  findByRouteNo(routeNo: string): Promise<Beacon | null>;
}

/**
 * fixture(DEMO_BEACONS) 단일 출처에서 읽는 구현체.
 * Supabase 환경변수가 없을 때 시연이 끊기지 않도록 하는 fallback으로 쓴다.
 * 실제 bus_beacons 테이블 조회는 repositories/supabase/beacon.repository.ts 참고.
 */
export class FixtureBeaconRepository implements BeaconRepository {
  constructor(private readonly beacons: readonly Beacon[] = DEMO_BEACONS) {}

  async findAll(): Promise<Beacon[]> {
    return [...this.beacons];
  }

  async findById(beaconId: BeaconId): Promise<Beacon | null> {
    return this.beacons.find((beacon) => beacon.beaconId === beaconId) ?? null;
  }

  async findByRouteNo(routeNo: string): Promise<Beacon | null> {
    return this.beacons.find((beacon) => beacon.routeNo === routeNo) ?? null;
  }
}
