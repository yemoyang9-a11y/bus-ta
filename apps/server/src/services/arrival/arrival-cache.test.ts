import assert from "node:assert/strict";
import test from "node:test";
import type { ArrivalInfo } from "@bus-ta/shared";
import { ArrivalCache } from "./arrival-cache.js";
import { ARRIVAL_POLL_MAX_MS, ARRIVAL_POLL_MIN_MS } from "./arrival-poll-policy.js";

const TARGET = { gbisStationId: "233000575", localBusId: "233000011" };
const MINUTE = 60_000;

/** 조회는 성공한 경우의 상태. 차량이 없으면 NO_VEHICLE 이다. */
function ok(arrivals: ArrivalInfo[]) {
  return arrivals.length > 0 ? ("AVAILABLE" as const) : ("NO_VEHICLE" as const);
}

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
      return { arrivals, arrivalStatus: ok(arrivals) };
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
      if (calls === 1) return { arrivals: [arrival(1)], arrivalStatus: "AVAILABLE" as const };
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

test("실패한 뒤 재시도 간격 안에는 GBIS를 다시 부르지 않는다", async () => {
  // 실패 항목을 캐시에 남기지 않으면 다음 요청이 곧장 캐시 미스가 되어,
  // 장애 중인 GBIS 를 요청마다 두드리게 된다.
  let calls = 0;
  let clock = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      throw new Error("down");
    },
    { now: () => clock },
  );

  await cache.get(TARGET);
  assert.equal(calls, 1);

  clock += ARRIVAL_POLL_MIN_MS - 1_000; // 19초
  await cache.get(TARGET);
  assert.equal(calls, 1, "재시도 간격 안에는 다시 부르면 안 된다");

  clock += 2_000; // 누적 21초
  await cache.get(TARGET);
  assert.equal(calls, 2, "간격이 지나면 다시 시도해야 한다");
});

test("재시도 간격 안에는 실패 상태(null)를 그대로 돌려준다", async () => {
  let clock = 0;
  const cache = new ArrivalCache(
    async () => {
      throw new Error("down");
    },
    { now: () => clock },
  );

  await cache.get(TARGET);
  clock += 5_000;

  const withinWindow = await cache.get(TARGET);
  assert.equal(withinWindow.arrivals, null, "실패 상태가 빈 배열로 바뀌면 안 된다");
});

test("같은 대상에 동시 요청이 와도 GBIS는 한 번만 부른다", async () => {
  let calls = 0;
  const cache = new ArrivalCache(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { arrivals: [arrival(5)], arrivalStatus: "AVAILABLE" as const };
  });

  await Promise.all([cache.get(TARGET), cache.get(TARGET), cache.get(TARGET)]);

  assert.equal(calls, 1, `동시 3회 요청에 GBIS를 ${calls}회 불렀다`);
});

test("실패한 조회가 inFlight 에 남아 영구히 막지 않는다", async () => {
  let calls = 0;
  let clock = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("down");
      return { arrivals: [arrival(4)], arrivalStatus: "AVAILABLE" as const };
    },
    { now: () => clock },
  );

  const failed = await cache.get(TARGET);
  assert.equal(failed.arrivals, null);

  // 재시도 간격이 지난 뒤에는 정상적으로 복구되어야 한다.
  clock += ARRIVAL_POLL_MIN_MS;
  const recovered = await cache.get(TARGET);
  assert.equal(recovered.predictedArrivalMinutes, 4, "실패가 캐시에 갇혀 복구를 막으면 안 된다");
});

test("노선이 다르면 갱신 주기를 따로 관리한다", async () => {
  const seen: string[] = [];
  const cache = new ArrivalCache(
    async (t) => {
      seen.push(t.localBusId);
      return {
        arrivals: t.localBusId === "A" ? [arrival(30)] : [arrival(2)],
        arrivalStatus: "AVAILABLE" as const,
      };
    },
    { now: () => 0 },
  );

  const a = await cache.get({ gbisStationId: "S", localBusId: "A" });
  const b = await cache.get({ gbisStationId: "S", localBusId: "B" });

  assert.deepEqual(seen, ["A", "B"]);
  assert.equal(a.nextRefreshInMs, ARRIVAL_POLL_MAX_MS);
  assert.equal(b.nextRefreshInMs, 1 * MINUTE);
});

test("전부 최신이어도 항목 수는 상한을 넘지 않는다", async () => {
  // 만료된 것만 지우면, 짧은 시간에 새 정류장·노선 조합이 몰릴 때 전부 최신이라
  // 하나도 못 지우고 무한히 쌓인다.
  let clock = 0;
  const cache = new ArrivalCache(async () => ({ arrivals: [arrival(30)], arrivalStatus: "AVAILABLE" as const }), {
    now: () => clock,
    maxEntries: 5,
  });

  for (let i = 0; i < 50; i += 1) {
    clock += 10; // 갱신 주기(5분)에 한참 못 미쳐 전부 최신 상태다
    await cache.get({ gbisStationId: "S", localBusId: `R${i}` });
  }

  // 가장 최근 항목은 남아 있고, 맨 처음 것은 밀려났어야 한다.
  const newest = await cache.get({ gbisStationId: "S", localBusId: "R49" });
  assert.equal(newest.fromCache, true, "최근 항목까지 밀어내면 캐시 의미가 없다");

  const oldest = await cache.get({ gbisStationId: "S", localBusId: "R0" });
  assert.equal(oldest.fromCache, false, "상한을 넘으면 오래된 항목부터 밀어내야 한다");
});

test("오래 쓰이지 않은 항목은 정리해 무한히 쌓이지 않게 한다", async () => {
  let clock = 0;
  const cache = new ArrivalCache(
    async () => ({ arrivals: [arrival(1)], arrivalStatus: "AVAILABLE" as const }),
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

// ─────────────────────────────────────────────
// 어댑터는 GBIS 실패를 예외가 아니라 arrivalStatus: UPSTREAM_ERROR 로 올린다.
// 캐시가 그걸 성공으로 받으면 실패가 "차량 없음"으로 굳고, 낡은 값 유지와 20초
// 재시도가 통째로 무력해진다. 아래 테스트들이 그 회귀를 고정한다.
// ─────────────────────────────────────────────

test("UPSTREAM_ERROR 를 성공으로 캐시하지 않는다 — 실패 경로로 보낸다", async () => {
  let clock = 0;
  let calls = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      return { arrivals: [], arrivalStatus: "UPSTREAM_ERROR" as const };
    },
    { now: () => clock },
  );

  const first = await cache.get(TARGET);
  assert.equal(first.arrivalStatus, "UPSTREAM_ERROR");
  assert.equal(first.arrivals, null, "조회 실패는 빈 배열이 아니라 null 이어야 한다");

  // 성공으로 캐시됐다면 폴링 정책상 최대 5분까지 안 부른다.
  // 실패로 처리했으면 최소 간격(20초) 뒤에 다시 부른다.
  clock += ARRIVAL_POLL_MIN_MS - 1_000;
  await cache.get(TARGET);
  assert.equal(calls, 1, "최소 간격 안에는 다시 부르지 않는다");

  clock += 2_000;
  await cache.get(TARGET);
  assert.equal(calls, 2, "최소 간격이 지나면 다시 부른다 — 5분을 기다리면 안 된다");
});

test("UPSTREAM_ERROR 여도 maxStaleMs 안이면 직전 값을 유지하되 상태는 실패로 남는다", async () => {
  let clock = 0;
  let calls = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      return calls === 1
        ? { arrivals: [arrival(1)], arrivalStatus: "AVAILABLE" as const }
        : { arrivals: [], arrivalStatus: "UPSTREAM_ERROR" as const };
    },
    { now: () => clock, maxStaleMs: 90_000 },
  );

  const good = await cache.get(TARGET);
  assert.equal(good.arrivalStatus, "AVAILABLE");

  // 1분 남은 값의 갱신 주기는 30초다. 31초 뒤면 갱신 시점은 지났지만
  // 낡은 정도(31초)는 아직 maxStaleMs(90초) 안이라 직전 값을 유지해야 한다.
  clock += 31_000;
  const stale = await cache.get(TARGET);

  assert.equal(stale.predictedArrivalMinutes, 1, "쓸 만한 직전 값은 유지한다");
  assert.equal(
    stale.arrivalStatus,
    "UPSTREAM_ERROR",
    "낡은 값을 '지금 확인한 값'으로 안내하면 이미 지나간 버스를 기다리게 된다",
  );
});

test("실패 뒤 캐시 적중에서도 상태가 UPSTREAM_ERROR 로 남는다", async () => {
  let clock = 0;
  let calls = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      return calls === 1
        ? { arrivals: [arrival(1)], arrivalStatus: "AVAILABLE" as const }
        : { arrivals: [], arrivalStatus: "UPSTREAM_ERROR" as const };
    },
    { now: () => clock, maxStaleMs: 90_000 },
  );

  await cache.get(TARGET);
  clock += 31_000;
  const stale = await cache.get(TARGET); // 실패 — 낡은 값 유지
  assert.equal(stale.predictedArrivalMinutes, 1);

  clock += 1_000; // 아직 재시도 간격 전이라 캐시에서 그대로 나온다
  const hit = await cache.get(TARGET);

  assert.equal(hit.fromCache, true);
  assert.equal(calls, 2, "재시도 간격 안에는 다시 부르지 않는다");
  assert.equal(hit.predictedArrivalMinutes, 1, "캐시 적중이라 값은 그대로다");
  assert.equal(hit.arrivalStatus, "UPSTREAM_ERROR", "캐시를 거쳐도 실패 사실이 지워지면 안 된다");
});

test("차량이 없는 정상 응답은 NO_VEHICLE 로 캐시된다 — 실패와 섞이지 않는다", async () => {
  let clock = 0;
  const cache = new ArrivalCache(
    async () => ({ arrivals: [], arrivalStatus: "NO_VEHICLE" as const }),
    { now: () => clock },
  );

  const snapshot = await cache.get(TARGET);

  assert.equal(snapshot.arrivalStatus, "NO_VEHICLE");
  assert.deepEqual(snapshot.arrivals, [], "조회에 성공했으므로 null 이 아니라 빈 배열이다");
});

test("NO_PREDICTION 은 상태를 유지하되 최소 간격 뒤에 다시 조회한다", async () => {
  // 레코드가 있다는 건 차가 배차돼 있다는 뜻이다. 빈 배열이라는 이유로 최대
  // 간격(5분)을 잡으면, 잠시 뒤 예상 시간이 생겨도 그동안 안내하지 못한다.
  let clock = 0;
  let calls = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      return calls === 1
        ? { arrivals: [], arrivalStatus: "NO_PREDICTION" as const }
        : { arrivals: [arrival(3)], arrivalStatus: "AVAILABLE" as const };
    },
    { now: () => clock },
  );

  const first = await cache.get(TARGET);
  assert.equal(first.arrivalStatus, "NO_PREDICTION");
  assert.deepEqual(first.arrivals, [], "조회는 성공했으므로 null 이 아니라 빈 배열이다");
  assert.equal(
    first.nextRefreshInMs,
    ARRIVAL_POLL_MIN_MS,
    "최대 간격(5분)이 아니라 최소 간격으로 다시 확인해야 한다",
  );

  clock += ARRIVAL_POLL_MIN_MS - 1_000;
  await cache.get(TARGET);
  assert.equal(calls, 1, "최소 간격 안에는 다시 부르지 않는다");

  clock += 2_000;
  const recovered = await cache.get(TARGET);
  assert.equal(calls, 2);
  assert.equal(recovered.arrivalStatus, "AVAILABLE", "예상 시간이 생기면 바로 되찾는다");
  assert.equal(recovered.predictedArrivalMinutes, 3);
});

test("NO_VEHICLE 은 기존대로 최대 간격을 유지한다 — NO_PREDICTION 과 다르다", async () => {
  // 레코드 자체가 없는 경우는 미운행·심야처럼 한동안 값이 없는 것이 정상이다.
  let clock = 0;
  const cache = new ArrivalCache(
    async () => ({ arrivals: [], arrivalStatus: "NO_VEHICLE" as const }),
    { now: () => clock },
  );

  const snapshot = await cache.get(TARGET);

  assert.equal(snapshot.arrivalStatus, "NO_VEHICLE");
  assert.equal(snapshot.nextRefreshInMs, ARRIVAL_POLL_MAX_MS);
});

test("직전 값이 NO_VEHICLE 이어도 실패하면 UPSTREAM_ERROR 로 바뀐다", async () => {
  // 실패 시 낡은 값 유지는 arrivals 가 빈 배열일 때도 적용된다. 그 결과
  // "arrivalStatus: UPSTREAM_ERROR + arrivals: []" 조합이 나올 수 있다.
  // 호출부는 배열이 비었는지가 아니라 arrivalStatus 를 보고 안내를 정해야 한다.
  //
  // NO_VEHICLE 의 갱신 주기는 최대 간격(5분)이라, 이 조합을 보려면 낡은 값 한도가
  // 그보다 길어야 한다. 기본값(90초)에서는 한도가 먼저 지나 arrivals 가 null 이 된다.
  let clock = 0;
  let calls = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      return calls === 1
        ? { arrivals: [], arrivalStatus: "NO_VEHICLE" as const }
        : { arrivals: [], arrivalStatus: "UPSTREAM_ERROR" as const };
    },
    { now: () => clock, maxStaleMs: 6 * MINUTE },
  );

  await cache.get(TARGET);
  clock += ARRIVAL_POLL_MAX_MS + 1_000; // 갱신 시점은 지났고 낡은 정도는 아직 한도 안이다
  const failed = await cache.get(TARGET);

  assert.equal(calls, 2);
  assert.equal(failed.arrivalStatus, "UPSTREAM_ERROR");
  assert.deepEqual(failed.arrivals, [], "빈 배열만 보고 '차가 없다'로 판단하면 안 된다");
});
