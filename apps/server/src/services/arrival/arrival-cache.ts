import type { ArrivalInfo } from "@bus-ta/shared";
import { nextArrivalPollDelayMs, shouldScanBeacon } from "./arrival-poll-policy.js";

/**
 * 도착정보를 적응형 주기로만 갱신하는 캐시.
 *
 * 앱은 운행 중 3초마다 위치를 보내지만 GBIS를 그때마다 부를 수는 없다.
 * 반대로 create_trip 때 한 번만 부르면 정류장에서 기다리는 내내 값이 낡는다.
 * 그래서 호출 시점은 앱이 아니라 이 캐시가 정한다 — 버스가 멀면 5분,
 * 가까우면 20초까지 좁힌다(arrival-poll-policy 참고).
 *
 * 캐시 키를 정류장이 아니라 "정류장 + 노선"으로 잡는 이유는, 같은 정류장이라도
 * 노선마다 남은 시간이 달라 갱신 주기가 갈리기 때문이다.
 */

export type ArrivalLookup = (target: {
  gbisStationId: string;
  localBusId: string;
}) => Promise<{ arrivals: ArrivalInfo[] }>;

export interface ArrivalSnapshot {
  arrivals: ArrivalInfo[];
  /** 첫 도착 차량의 예상 도착 시간. 값이 없으면 null. */
  predictedArrivalMinutes: number | null;
  /** 지금 비콘 스캔이 켜져 있어야 하는지. 한 번 true가 되면 계속 true다. */
  scanBeacon: boolean;
  /** 이 값이 GBIS를 새로 불러 얻은 것인지, 캐시에서 나온 것인지. */
  fromCache: boolean;
  /** 다음 갱신까지 남은 시간(ms). 호출부가 안내 주기를 잡을 때 참고한다. */
  nextRefreshInMs: number;
}

interface CacheEntry {
  arrivals: ArrivalInfo[];
  fetchedAt: number;
  refreshAfter: number;
  /** 스캔은 한 번 켜지면 끄지 않으므로 노선별로 기억해 둔다. */
  scanBeacon: boolean;
}

function readPredictedArrivalMinutes(arrivals: ArrivalInfo[]): number | null {
  const first = arrivals[0]?.predictedArrivalMinutes;
  return typeof first === "number" && Number.isFinite(first) ? first : null;
}

export class ArrivalCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly lookup: ArrivalLookup,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 도착정보를 돌려준다. 갱신 시점이 지났을 때만 실제로 GBIS를 부른다.
   *
   * 조회에 실패하면 직전 값을 그대로 쓰고 최소 간격 뒤에 다시 시도한다.
   * 한 번 실패했다고 안내를 비우면 사용자에게는 버스가 사라진 것처럼 보인다.
   */
  async get(target: { gbisStationId: string; localBusId: string }): Promise<ArrivalSnapshot> {
    const key = `${target.gbisStationId}:${target.localBusId}`;
    const at = this.now();
    const cached = this.entries.get(key);

    if (cached && at < cached.refreshAfter) {
      return this.toSnapshot(cached, at, true);
    }

    let arrivals: ArrivalInfo[];
    try {
      arrivals = (await this.lookup(target)).arrivals;
    } catch (error) {
      console.error(
        "[trips/arrival] 도착정보 갱신 실패, 직전 값을 유지한다",
        `station=${target.gbisStationId}`,
        `route=${target.localBusId}`,
        `message=${error instanceof Error ? error.message : "unknown"}`,
      );

      const fallback: CacheEntry = {
        arrivals: cached?.arrivals ?? [],
        fetchedAt: cached?.fetchedAt ?? at,
        refreshAfter: at + nextArrivalPollDelayMs(null),
        scanBeacon: shouldScanBeacon(
          readPredictedArrivalMinutes(cached?.arrivals ?? []),
          cached?.scanBeacon ?? false,
        ),
      };
      this.entries.set(key, fallback);
      return this.toSnapshot(fallback, at, true);
    }

    const predicted = readPredictedArrivalMinutes(arrivals);
    const entry: CacheEntry = {
      arrivals,
      fetchedAt: at,
      refreshAfter: at + nextArrivalPollDelayMs(predicted),
      scanBeacon: shouldScanBeacon(predicted, cached?.scanBeacon ?? false),
    };

    this.entries.set(key, entry);
    return this.toSnapshot(entry, at, false);
  }

  /** 운행이 끝나면 해당 노선의 기억을 지운다. 스캔 상태가 다음 운행으로 새지 않게 한다. */
  clear(target: { gbisStationId: string; localBusId: string }): void {
    this.entries.delete(`${target.gbisStationId}:${target.localBusId}`);
  }

  private toSnapshot(entry: CacheEntry, at: number, fromCache: boolean): ArrivalSnapshot {
    return {
      arrivals: entry.arrivals,
      predictedArrivalMinutes: readPredictedArrivalMinutes(entry.arrivals),
      scanBeacon: entry.scanBeacon,
      fromCache,
      nextRefreshInMs: Math.max(0, entry.refreshAfter - at),
    };
  }
}
