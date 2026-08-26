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
function buildCache(responses: ArrivalInfo[][]) {
  let clock = 0;
  let calls = 0;

  const cache = new ArrivalCache(
    async () => {
      const arrivals = responses[Math.min(calls, responses.length - 1)] ?? [];
      calls += 1;
      return { arrivals };
    },
    () => clock,
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

  // 5분 동안 3초 간격으로 100번 물어본다.
  for (let i = 0; i < 100; i += 1) {
    h.advance(3_000);
    await h.cache.get(TARGET);
  }

  // 30분 남은 상태의 갱신 주기는 상한인 5분이다. 300초 동안 호출은 몇 번뿐이어야 한다.
  assert.ok(h.calls <= 2, `호출이 ${h.calls}회로 과도하다`);
});

test("갱신 시점이 지나면 다시 부른다", async () => {
  const h = buildCache([[arrival(30)], [arrival(24)]]);

  await h.cache.get(TARGET);
  h.advance(ARRIVAL_POLL_MAX_MS);

  const refreshed = await h.cache.get(TARGET);
  assert.equal(refreshed.fromCache, false);
  assert.equal(h.calls, 2);
  assert.equal(refreshed.predictedArrivalMinutes, 24);
});

test("버스가 가까워지면 갱신 주기가 좁아진다", async () => {
  const far = buildCache([[arrival(30)]]);
  const near = buildCache([[arrival(2)]]);

  const farSnapshot = await far.cache.get(TARGET);
  const nearSnapshot = await near.cache.get(TARGET);

  assert.equal(farSnapshot.nextRefreshInMs, ARRIVAL_POLL_MAX_MS);
  assert.equal(nearSnapshot.nextRefreshInMs, 1 * MINUTE);
});

test("5분 이내로 들어오면 스캔 신호가 켜진다", async () => {
  const h = buildCache([[arrival(30)], [arrival(4)]]);

  const before = await h.cache.get(TARGET);
  assert.equal(before.scanBeacon, false);

  h.advance(ARRIVAL_POLL_MAX_MS);
  const after = await h.cache.get(TARGET);
  assert.equal(after.scanBeacon, true);
});

test("앞차가 떠나 도착시간이 늘어나도 스캔 신호는 꺼지지 않는다", async () => {
  // 실측 720-2번: 1분 → 9분(다음 차량으로 교체)
  const h = buildCache([[arrival(1)], [arrival(9)]]);

  const first = await h.cache.get(TARGET);
  assert.equal(first.scanBeacon, true);

  h.advance(ARRIVAL_POLL_MAX_MS);
  const second = await h.cache.get(TARGET);
  assert.equal(second.predictedArrivalMinutes, 9, "값 자체는 갱신된다");
  assert.equal(second.scanBeacon, true, "스캔 신호는 유지되어야 한다");
});

test("도착정보가 비어 있으면 스캔을 켜고 최대 주기로 재시도한다", async () => {
  const h = buildCache([[]]);

  const snapshot = await h.cache.get(TARGET);
  assert.deepEqual(snapshot.arrivals, []);
  assert.equal(snapshot.predictedArrivalMinutes, null);
  assert.equal(snapshot.scanBeacon, true, "정보가 없다고 스캔을 막으면 탑승을 놓친다");
  assert.equal(snapshot.nextRefreshInMs, ARRIVAL_POLL_MAX_MS);
});

test("조회에 실패하면 직전 값을 유지하고 안내를 비우지 않는다", async () => {
  let calls = 0;
  let clock = 0;
  const cache = new ArrivalCache(
    async () => {
      calls += 1;
      if (calls === 1) return { arrivals: [arrival(6)] };
      throw new Error("network error");
    },
    () => clock,
  );

  const first = await cache.get(TARGET);
  assert.equal(first.predictedArrivalMinutes, 6);

  clock += ARRIVAL_POLL_MAX_MS;
  const afterFailure = await cache.get(TARGET);

  assert.equal(afterFailure.predictedArrivalMinutes, 6, "실패했다고 값을 버리면 안 된다");
  assert.ok(afterFailure.nextRefreshInMs > 0, "실패 뒤에도 재시도 시점이 잡혀야 한다");
});

test("노선이 다르면 갱신 주기를 따로 관리한다", async () => {
  let clock = 0;
  const seen: string[] = [];
  const cache = new ArrivalCache(
    async (t) => {
      seen.push(t.localBusId);
      return { arrivals: t.localBusId === "A" ? [arrival(30)] : [arrival(2)] };
    },
    () => clock,
  );

  const a = await cache.get({ gbisStationId: "S", localBusId: "A" });
  const b = await cache.get({ gbisStationId: "S", localBusId: "B" });

  assert.deepEqual(seen, ["A", "B"], "같은 정류장이어도 노선별로 조회한다");
  assert.equal(a.nextRefreshInMs, ARRIVAL_POLL_MAX_MS);
  assert.equal(b.nextRefreshInMs, 1 * MINUTE);
});

test("운행이 끝나면 스캔 상태가 다음 운행으로 새지 않는다", async () => {
  const h = buildCache([[arrival(2)], [arrival(30)]]);

  const first = await h.cache.get(TARGET);
  assert.equal(first.scanBeacon, true);

  h.cache.clear(TARGET);

  const afterClear = await h.cache.get(TARGET);
  assert.equal(afterClear.scanBeacon, false, "clear 뒤에는 스캔 상태가 초기화되어야 한다");
});

test("도착 직전에도 최소 주기보다 자주 부르지 않는다", async () => {
  const h = buildCache([[arrival(0)]]);
  const snapshot = await h.cache.get(TARGET);
  assert.equal(snapshot.nextRefreshInMs, ARRIVAL_POLL_MIN_MS);
});
