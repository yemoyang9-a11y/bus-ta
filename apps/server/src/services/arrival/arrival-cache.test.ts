import assert from "node:assert/strict";
import test from "node:test";
import type { ArrivalInfo } from "@bus-ta/shared";
import { ArrivalCache } from "./arrival-cache.js";
import { ARRIVAL_POLL_MAX_MS, ARRIVAL_POLL_MIN_MS } from "./arrival-poll-policy.js";

const TARGET = { gbisStationId: "233000575", localBusId: "233000011" };
const MINUTE = 60_000;

function arrival(minutes: number): ArrivalInfo {
  return {
    predictedArrivalMinutes: minutes,
    occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
  };
}

/** 호출 횟수를 세고 시간을 직접 흘려보내는 테스트 하네스. */
function buildCache(responses: ArrivalInfo[][], maxStaleMs?: number) {
  let clock = 0;
  let calls = 0;

  const cache = new ArrivalCache(
    async () => {
      const arrivals = responses[Math.min(calls, responses.length - 1)] ?? [];
      calls += 1;
      return { arrivals };
    },
    { now: () => clock, ...(maxStaleMs === undefined ? {} : { maxStaleMs }) },
  );

  return {
    cache,
    advance: (ms: number) => {
      clock += ms;
    },
    get calls() {
      return calls;
    },
  };
}

test("첫 조회는 GBIS를 부르고 두 번째부터는 캐시를 쓴다", async () => {
  const h = buildCache([[arrival(30)]]);

  const first = await h.cache.get(TARGET);
  assert.equal(first.fromCache, false);
  assert.equal(h.calls, 1);

  const second = await h.cache.get(TARGET);
  assert.equal(second.fromCache, true);
  assert.equal(h.calls, 1, "갱신 시점 전에는 다시 부르지 않는다");
});

test("앱이 3초마다 물어도 GBIS 호출은 갱신 주기를 따른다", async () => {
  const h = buildCache([[arrival(30)]]);
  await h.cache.get(TARGET);

  for (let i = 0; i < 100; i += 1) {
    h.advance(3_000);
    await h.cache.get(TARGET);
  }

  assert.ok(h.calls <= 2, `호출이 ${h.calls}회로 과도하다`);
});

test("갱신 시점이 지나면 다시 부른다", async () => {
  const h = buildCache([[arrival(30)], [arrival(24)]]);

  await h.cache.get(TARGET);
  h.advance(ARRIVAL_POLL_MAX_MS);

  const refreshed = await h.cache.get(TARGET);
  assert.equal(refreshed.fromCache, false);
  assert.equal(refreshed.predictedArrivalMinutes, 24);
});

test("버스가 가까워지면 갱신 주기가 좁아진다", async () => {
  const far = buildCache([[arrival(30)]]);
  const near = buildCache([[arrival(2)]]);

  assert.equal((await far.cache.get(TARGET)).nextRefreshInMs, ARRIVAL_POLL_MAX_MS);
  assert.equal((await near.cache.get(TARGET)).nextRefreshInMs, 1 * MINUTE);
});

test("실시간 차량이 없으면 빈 배열이고, 조회 실패가 아니다", async () => {
  const h = buildCache([[]]);

  const snapshot = await h.cache.get(TARGET);
  assert.deepEqual(snapshot.arrivals, [], "빈 배열은 '차량 없음'을 뜻한다");
  assert.notEqual(snapshot.arrivals, null);
  assert.equal(snapshot.predictedArrivalMinutes, null);
});

// ─────────────────────────────────────────────
// 리뷰 지적 반영 (2026-08-26)
// ─────────────────────────────────────────────

test("첫 조회가 실패하면 빈 배열이 아니라 null 을 돌려준다", async () => {
  // 빈 배열로 접으면 호출부가 "실시간 차량 없음"으로 오해한다.
  const cache = new ArrivalCache(async () => {
    throw new Error("GBIS down");
  });

  const snapshot = await cache.get(TARGET);
  assert.equal(snapshot.arrivals, null, "조회 실패는 null 이어야 한다");
  assert.equal(snapshot.predictedArrivalMinutes, null);
});

/**
 * 1분 남은 버스는 갱신 주기가 30초라, 40초 뒤부터 갱신을 시도하고 실패를 겪는다.
 * 만료 한도를 90초로 두면 "잠시 유지 → 결국 버림"을 한 흐름에서 볼 수 있다.
 */
function buildFlakyCache() {
  let calls = 0;
  let clock = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      if (calls === 1) return { arrivals: [arrival(1)] };
      throw new Error("network error");
    },
    { now: () => clock, maxStaleMs: 90_000 },
  );

  return {
    cache,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("갱신에 실패하면 직전 값을 잠시 유지한다", async () => {
  const h = buildFlakyCache();

  await h.cache.get(TARGET);
  h.advance(40_000); // 갱신 시점(30초)은 지났고 만료 한도(90초)는 안 지났다

  const afterFailure = await h.cache.get(TARGET);
  assert.equal(afterFailure.predictedArrivalMinutes, 1, "일시적 실패에 안내를 비우지 않는다");
});

test("실패가 이어지면 낡은 값을 버리고 null 로 바꾼다", async () => {
  // 버스가 이미 지나갔는데 계속 "1분 후 도착"이라고 안내하면 위험하다.
  const h = buildFlakyCache();

  await h.cache.get(TARGET);

  h.advance(40_000);
  assert.equal((await h.cache.get(TARGET)).predictedArrivalMinutes, 1, "아직은 유지");

  h.advance(60_000); // 최초 조회로부터 100초 > 90초 한도
  const expired = await h.cache.get(TARGET);
  assert.equal(expired.arrivals, null, "한도를 넘긴 값은 버려야 한다");
});

test("실패 뒤에는 최소 간격으로 빠르게 재시도한다", async () => {
  const cache = new ArrivalCache(async () => {
    throw new Error("down");
  });

  const snapshot = await cache.get(TARGET);
  assert.equal(
    snapshot.nextRefreshInMs,
    ARRIVAL_POLL_MIN_MS,
    "실패 후 5분을 기다리면 정상 값을 되찾는 데 너무 오래 걸린다",
  );
});

test("같은 대상에 동시 요청이 와도 GBIS는 한 번만 부른다", async () => {
  let calls = 0;
  const cache = new ArrivalCache(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { arrivals: [arrival(5)] };
  });

  await Promise.all([cache.get(TARGET), cache.get(TARGET), cache.get(TARGET)]);

  assert.equal(calls, 1, `동시 3회 요청에 GBIS를 ${calls}회 불렀다`);
});

test("동시 요청이 실패해도 다음 요청은 다시 시도할 수 있다", async () => {
  let calls = 0;
  const cache = new ArrivalCache(async () => {
    calls += 1;
    if (calls === 1) throw new Error("down");
    return { arrivals: [arrival(4)] };
  });

  const failed = await cache.get(TARGET);
  assert.equal(failed.arrivals, null);

  const recovered = await cache.get(TARGET);
  assert.equal(recovered.predictedArrivalMinutes, 4, "실패한 요청이 캐시에 남아 막으면 안 된다");
});

test("노선이 다르면 갱신 주기를 따로 관리한다", async () => {
  const seen: string[] = [];
  const cache = new ArrivalCache(
    async (t) => {
      seen.push(t.localBusId);
      return { arrivals: t.localBusId === "A" ? [arrival(30)] : [arrival(2)] };
    },
    { now: () => 0 },
  );

  const a = await cache.get({ gbisStationId: "S", localBusId: "A" });
  const b = await cache.get({ gbisStationId: "S", localBusId: "B" });

  assert.deepEqual(seen, ["A", "B"]);
  assert.equal(a.nextRefreshInMs, ARRIVAL_POLL_MAX_MS);
  assert.equal(b.nextRefreshInMs, 1 * MINUTE);
});

test("오래 쓰이지 않은 항목은 정리해 무한히 쌓이지 않게 한다", async () => {
  let clock = 0;
  const cache = new ArrivalCache(
    async () => ({ arrivals: [arrival(1)] }),
    { now: () => clock, maxStaleMs: 1_000, maxEntries: 2 },
  );

  await cache.get({ gbisStationId: "S", localBusId: "R1" });
  await cache.get({ gbisStationId: "S", localBusId: "R2" });

  clock += 10 * MINUTE;
  await cache.get({ gbisStationId: "S", localBusId: "R3" });

  // R1·R2 는 정리됐어야 하므로 다시 물으면 새로 조회한다.
  const revisited = await cache.get({ gbisStationId: "S", localBusId: "R1" });
  assert.equal(revisited.fromCache, false, "정리된 항목은 새로 조회되어야 한다");
});
