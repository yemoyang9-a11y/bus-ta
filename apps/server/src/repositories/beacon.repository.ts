import { DEMO_BEACONS } from "@bus-ta/shared";
import type { Beacon, BeaconId } from "@bus-ta/shared";

/** bus_beacons 테이블 접근 인터페이스 */
export interface BeaconRepository {
  findAll(): Promise<Beacon[]>;
  findById(beaconId: BeaconId): Promise<Beacon | null>;
  findByRouteNo(routeNo: string): Promise<Beacon | null>;
}

/**
 * 중간평가 MVP 비콘 조회 — fixture(DEMO_BEACONS) 단일 출처에서 읽는다.
 * 실제 bus_beacons 테이블 연동이 준비되면 동일 인터페이스 구현체로 교체한다.
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

// TODO: Supabase bus_beacons 구현체 추가 (중간평가 이후)
