import type { ArrivalInfo } from "@bus-ta/shared";
import { ARRIVAL_STATUS, type ArrivalStatus } from "./arrival-status.js";
import { ARRIVAL_POLL_MIN_MS, nextArrivalPollDelayMs } from "./arrival-poll-policy.js";

/**
 * 도착정보를 적응형 주기로만 갱신하는 캐시.
 *
 * 앱은 운행 중 3초마다 위치를 보내지만 GBIS를 그때마다 부를 수는 없다.
 * 그래서 호출 시점은 호출부가 아니라 이 캐시가 정한다 — 버스가 멀면 5분,
 * 가까우면 20초까지 좁힌다(arrival-poll-policy 참고).
 *
 * 캐시 키를 정류장이 아니라 "정류장 + 노선"으로 잡는 이유는, 같은 정류장이라도
 * 노선마다 남은 시간이 달라 갱신 주기가 갈리기 때문이다.
 *
 * 이 캐시는 도착정보만 다룬다. 비콘 스캔 여부처럼 사용자의 운행마다 달라지는
 * 상태는 여기 두지 않는다 — 프로세스 전역 캐시에 두면 같은 정류장을 쓰는 다른
 * 사용자에게 상태가 새어 나간다. 스캔 판단은 호출부가 자기 운행 상태와 함께
 * `shouldScanBeacon` 을 직접 호출한다.
 */

export type ArrivalLookup = (target: {
  gbisStationId: string;
  localBusId: string;
}) => Promise<{ arrivals: ArrivalInfo[]; arrivalStatus: ArrivalStatus }>;

export interface ArrivalTarget {
  gbisStationId: string;
  localBusId: string;
}

export interface ArrivalSnapshot {
  /** 조회에 성공했으면 도착 차량 배열(없으면 빈 배열), 실패했으면 null. */
  arrivals: ArrivalInfo[] | null;
  /**
   * 이 스냅샷을 어떻게 안내해야 하는지.
   *
   * 갱신에 실패했는데 maxStaleMs 안의 직전 값을 유지한 경우에는
   * `UPSTREAM_ERROR` 이면서 `arrivals` 가 비어 있지 않을 수 있다. 그때는
   * "지금은 확인이 안 되는데 조금 전 정보로는 …" 처럼 낡은 값임을 밝혀야 한다.
   * 확실한 값처럼 안내하면 이미 지나간 버스를 기다리게 만든다.
   */
  arrivalStatus: ArrivalStatus;
  /** 첫 도착 차량의 예상 도착 시간. 값이 없거나 조회에 실패했으면 null. */
  predictedArrivalMinutes: number | null;
  /** 이 값이 GBIS를 새로 불러 얻은 것인지, 캐시에서 나온 것인지. */
  fromCache: boolean;
  /** 다음 갱신까지 남은 시간(ms). 호출부가 안내 주기를 잡을 때 참고한다. */
  nextRefreshInMs: number;
}

interface CacheEntry {
  /** 마지막으로 성공한 조회 결과. 한 번도 성공하지 못했으면 null. */
  arrivals: ArrivalInfo[] | null;
  /** arrivals 를 실제로 받아온 시각. 실패해도 갱신하지 않아 낡은 정도를 잰다. */
  fetchedAt: number;
  refreshAfter: number;
  /**
   * 이 항목을 어떻게 안내해야 하는지. 실패 뒤 낡은 값을 유지한 항목은
   * arrivals 가 남아 있어도 UPSTREAM_ERROR 로 남아, 다음 캐시 적중에서도
   * "지금 확인한 값"으로 둔갑하지 않는다.
   */
  arrivalStatus: ArrivalStatus;
}

export interface ArrivalCacheOptions {
  now?: () => number;
  /**
   * 갱신에 실패했을 때 직전 값을 계속 쓸 수 있는 한도.
   *
   * 실패했다고 곧장 안내를 비우면 일시적인 오류에도 버스가 사라진 것처럼 보인다.
   * 그렇다고 무기한 유지하면 GBIS가 죽은 동안 이미 지나간 버스를 계속
   * "N분 후 도착"이라고 안내하게 된다. 시각장애인 안내에서는 낡은 값이
   * 값 없음보다 위험하므로 한도를 넘으면 버린다.
   */
  maxStaleMs?: number;
  /** 만료된 항목을 정리하기 시작하는 크기. 정류장·노선 조합이 무한히 쌓이지 않게 한다. */
  maxEntries?: number;
}

const DEFAULT_MAX_STALE_MS = 90_000;
const DEFAULT_MAX_ENTRIES = 500;

function readPredictedArrivalMinutes(arrivals: ArrivalInfo[]): number | null {
  const first = arrivals[0]?.predictedArrivalMinutes;
  return typeof first === "number" && Number.isFinite(first) ? first : null;
}

export class ArrivalCache {
  private readonly entries = new Map<string, CacheEntry>();
  /** 진행 중인 조회. 같은 대상에 동시 요청이 와도 GBIS는 한 번만 부른다. */
  private readonly inFlight = new Map<
    string,
    Promise<{ arrivals: ArrivalInfo[]; arrivalStatus: ArrivalStatus }>
  >();
  private readonly now: () => number;
  private readonly maxStaleMs: number;
  private readonly maxEntries: number;

  constructor(
    private readonly lookup: ArrivalLookup,
    options: ArrivalCacheOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * 도착정보를 돌려준다. 갱신 시점이 지났을 때만 실제로 GBIS를 부른다.
   *
   * 갱신에 실패하면 직전 값을 `maxStaleMs` 동안만 더 쓰고, 그 뒤로는
   * `arrivals: null`(조회 실패)로 바꾼다. 호출부는 null 과 빈 배열을 구분해
   * "확인하지 못함"과 "실시간 차량 없음"을 다르게 안내할 수 있다.
   */
  async get(target: ArrivalTarget): Promise<ArrivalSnapshot> {
    const key = `${target.gbisStationId}:${target.localBusId}`;
    const at = this.now();
    const cached = this.entries.get(key);

    if (cached && at < cached.refreshAfter) {
      return this.toSnapshot(cached.arrivals, at, cached.refreshAfter, true, cached.arrivalStatus);
    }

    try {
      const result = await this.fetchOnce(key, target);

      // 어댑터는 GBIS 실패를 예외가 아니라 UPSTREAM_ERROR 로 올린다. 이걸 성공으로
      // 받아 캐시에 넣으면 실패가 "차량 없음"으로 굳고, 아래 낡은 값 유지와 20초
      // 재시도가 통째로 무력해진다. 상태를 보고 실패 경로로 보낸다.
      if (result.arrivalStatus === ARRIVAL_STATUS.UPSTREAM_ERROR) {
        return this.rememberFailure(key, target, at, cached);
      }

      const arrivals = result.arrivals;
      // NO_PREDICTION 은 "차가 없다"가 아니라 "레코드는 있는데 예상 시간만 비었다"이다.
      // 빈 배열이라는 이유로 최대 간격(5분)을 잡으면, 잠시 뒤 예상 시간이 생겨도
      // 그동안 안내하지 못한다. 이 상태만 최소 간격으로 다시 확인한다.
      // NO_VEHICLE(레코드 자체가 없음)은 기존대로 최대 간격을 유지한다 — 미운행·
      // 심야처럼 한동안 값이 없는 것이 정상인 경우다.
      const refreshDelay =
        result.arrivalStatus === ARRIVAL_STATUS.NO_PREDICTION
          ? ARRIVAL_POLL_MIN_MS
          : nextArrivalPollDelayMs(readPredictedArrivalMinutes(arrivals));
      const entry: CacheEntry = {
        arrivals,
        fetchedAt: at,
        refreshAfter: at + refreshDelay,
        arrivalStatus: result.arrivalStatus,
      };

      this.entries.set(key, entry);
      this.evictExpired(at);
      return this.toSnapshot(arrivals, at, entry.refreshAfter, false, result.arrivalStatus);
    } catch (error) {
      console.error(
        "[trips/arrival] 도착정보 갱신 실패",
        `station=${target.gbisStationId}`,
        `route=${target.localBusId}`,
        `message=${error instanceof Error ? error.message : "unknown"}`,
      );

      return this.rememberFailure(key, target, at, cached);
    }
  }

  /**
   * 조회 실패를 캐시에 남기고 스냅샷으로 돌려준다.
   *
   * 예외로 던져진 실패와 어댑터가 UPSTREAM_ERROR 로 올린 실패를 같은 경로로
   * 처리한다. 두 경우의 안내와 재시도 정책이 같아야 하기 때문이다.
   *
   * 실패 뒤에는 최소 간격으로 빠르게 재시도한다. 낡은 값을 오래 들고 있는 것보다
   * 정상 값을 빨리 되찾는 편이 안전하다. 다만 이 간격이 실제로 지켜지려면 실패
   * 사실도 캐시에 남겨야 한다 — 항목을 지워 버리면 바로 다음 요청이 캐시 미스가
   * 되어 GBIS 를 곧장 다시 두드린다.
   */
  private rememberFailure(
    key: string,
    target: ArrivalTarget,
    at: number,
    cached: CacheEntry | undefined,
  ): ArrivalSnapshot {
    const refreshAfter = at + ARRIVAL_POLL_MIN_MS;
    const staleFor = cached?.arrivals ? at - cached.fetchedAt : Number.POSITIVE_INFINITY;
    const keepStale = cached?.arrivals != null && staleFor <= this.maxStaleMs;

    const entry: CacheEntry = keepStale
      ? // 아직 쓸 만한 직전 값이 있으면 유지하되, 그 값이 언제 것인지는 그대로 둔다.
        // fetchedAt 을 갱신하면 낡은 값이 영원히 젊어져 한도가 의미를 잃는다.
        { ...cached!, refreshAfter, arrivalStatus: ARRIVAL_STATUS.UPSTREAM_ERROR }
      : {
          arrivals: null,
          fetchedAt: cached?.fetchedAt ?? at,
          refreshAfter,
          arrivalStatus: ARRIVAL_STATUS.UPSTREAM_ERROR,
        };

    this.entries.set(key, entry);
    this.evictExpired(at);
    // 낡은 값을 유지하더라도 상태는 UPSTREAM_ERROR 다. 지금 확인한 값이 아니다.
    return this.toSnapshot(entry.arrivals, at, refreshAfter, true, ARRIVAL_STATUS.UPSTREAM_ERROR);
  }

  /** 같은 대상에 대한 동시 조회를 하나로 합친다. */
  private async fetchOnce(
    key: string,
    target: ArrivalTarget,
  ): Promise<{ arrivals: ArrivalInfo[]; arrivalStatus: ArrivalStatus }> {
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.lookup(target).finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, request);
    return request;
  }

  /**
   * 항목 수를 maxEntries 이하로 유지한다.
   *
   * 정류장·노선 조합은 사용자가 검색할수록 계속 늘어난다. 먼저 갱신 시점이 한참
   * 지난 항목을 버리고, 그래도 한도를 넘으면 오래된 순서로 더 버린다. 만료된 것만
   * 지우면 짧은 시간에 새 조합이 몰릴 때 전부 최신이라 하나도 못 지운다.
   *
   * Map 은 삽입 순서를 지키므로 앞쪽이 오래된 항목이다.
   */
  private evictExpired(at: number): void {
    if (this.entries.size <= this.maxEntries) return;

    for (const [key, entry] of this.entries) {
      if (at - entry.refreshAfter > this.maxStaleMs) {
        this.entries.delete(key);
      }
    }

    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(key);
    }
  }

  /** 특정 대상의 캐시를 비운다. 테스트와 운행 종료 정리에 쓴다. */
  clear(target: ArrivalTarget): void {
    const key = `${target.gbisStationId}:${target.localBusId}`;
    this.entries.delete(key);
  }

  private toSnapshot(
    arrivals: ArrivalInfo[] | null,
    at: number,
    refreshAfter: number,
    fromCache: boolean,
    arrivalStatus: ArrivalStatus,
  ): ArrivalSnapshot {
    return {
      arrivals,
      arrivalStatus,
      predictedArrivalMinutes: arrivals ? readPredictedArrivalMinutes(arrivals) : null,
      fromCache,
      nextRefreshInMs: Math.max(0, refreshAfter - at),
    };
  }
}
