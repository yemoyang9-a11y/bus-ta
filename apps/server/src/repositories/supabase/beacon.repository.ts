import { asBeaconId } from "@bus-ta/shared";
import type { Beacon, BeaconId } from "@bus-ta/shared";
import { readSupabaseConfig, type SupabaseConfig } from "../../config/supabase.js";
import type { BeaconRepository } from "../beacon.repository.js";

type Env = Partial<Record<string, string | undefined>>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createSupabaseBeaconRepositoryFromEnv(
  env: Env = process.env,
  fetchImpl: FetchLike = fetch,
): SupabaseBeaconRepository | null {
  const config = readSupabaseConfig(env);
  return config ? new SupabaseBeaconRepository(config, fetchImpl) : null;
}

/**
 * bus_beacons 테이블 조회 구현체. Supabase REST 접근 패턴은
 * SupabaseTripRepository 와 동일하게 맞춘다. fixture(DEMO_BEACONS) 대신
 * 실제 DB 행에서 targetBeaconId 를 조회한다.
 */
export class SupabaseBeaconRepository implements BeaconRepository {
  constructor(
    private readonly config: SupabaseConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async findAll(): Promise<Beacon[]> {
    const rows = await this.selectRows("bus_beacons", "order=created_at.desc");
    return rows.map(toBeacon);
  }

  async findById(beaconId: BeaconId): Promise<Beacon | null> {
    const rows = await this.selectRows(
      "bus_beacons",
      `beacon_id=eq.${encodeURIComponent(beaconId)}&limit=1`,
    );
    const row = rows[0];
    return row ? toBeacon(row) : null;
  }

  async findByRouteNo(routeNo: string): Promise<Beacon | null> {
    // 한 노선에 여러 차량 비콘이 있을 수 있으므로 ACTIVE 중 최신 1건을 반환한다.
    const rows = await this.selectRows(
      "bus_beacons",
      `route_no=eq.${encodeURIComponent(routeNo)}&status=eq.ACTIVE&order=created_at.desc&limit=1`,
    );
    const row = rows[0];
    return row ? toBeacon(row) : null;
  }

  private async selectRows(table: string, query: string): Promise<Record<string, unknown>[]> {
    const response = await this.fetchImpl(`${this.config.url}/rest/v1/${table}?select=*&${query}`, {
      method: "GET",
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`Supabase select failed for ${table}: ${response.status}`);
    }

    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
  }

  private headers() {
    return {
      apikey: this.config.apiKey,
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }
}

function toBeacon(row: Record<string, unknown>): Beacon {
  const localBusId = readNullableString(row, "local_bus_id");
  const vehicleId = readNullableString(row, "vehicle_id");

  return {
    beaconId: asBeaconId(readString(row, "beacon_id")),
    routeNo: readString(row, "route_no"),
    ...(localBusId !== null ? { localBusId } : {}),
    ...(vehicleId !== null ? { vehicleId } : {}),
    targetBeaconId: readString(row, "target_beacon_id"),
    isMock: readBoolean(row, "is_mock"),
  };
}

function readString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string`);
  }
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a nullable string`);
  }
  return value;
}

function readBoolean(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${key} to be a boolean`);
  }
  return value;
}
