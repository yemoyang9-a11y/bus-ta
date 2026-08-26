import assert from "node:assert/strict";
import test from "node:test";
import { mockSearchRoutes } from "../../adapters/routes/mock-route-search.adapter.js";
import { ArrivalCache } from "../arrival/arrival-cache.js";
import { searchRoutes } from "./search-routes.service.js";

/**
 * 라우터가 실제로 조립하는 경로(캐시 → 검색 서비스)를 그대로 태우는 테스트.
 *
 * 단위 테스트에서 getArrivals 에 곧장 예외를 던지는 함수를 주입하면, 캐시가
 * 실패를 어떻게 바깥으로 내보내는지를 건너뛰게 된다. 실제로 리뷰에서 이 틈으로
 * "조회 실패인데 arrivals: [] 가 붙는" 문제가 드러났으므로, 라우터와 같은
 * 방식으로 연결해 검증한다.
 */

const request = { destination: "수원대", latitude: 37.49, longitude: 127.03 };

/** routes.ts 가 getArrivals 를 만드는 방식과 동일하게 조립한다. */
function buildGetArrivals(cache: ArrivalCache) {
  return async (candidate: { gbisStationId: string; localBusId: string }) => {
    const snapshot = await cache.get(candidate);
    if (snapshot.arrivals === null) {
      throw new Error("도착정보를 확인할 수 없습니다.");
    }
    return snapshot.arrivals;
  };
}

const guideOneCandidate = async () => ({
  selectedCandidates: [{ candidateId: 1, guideMessage: "1번 후보 안내입니다." }],
});

test("GBIS 조회가 실패하면 arrivals 필드를 생략한다", async () => {
  const cache = new ArrivalCache(async () => {
    throw new Error("GBIS down");
  });

  const result = await searchRoutes(request, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: guideOneCandidate,
    getArrivals: buildGetArrivals(cache),
    now: () => "2026-08-26T18:00:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;

  const route = result.body.routes[0];
  assert.ok(route, "노선 안내 자체는 유지되어야 한다");
  assert.equal(
    route.arrivals,
    undefined,
    "조회 실패인데 빈 배열을 붙이면 '실시간 차량 없음'으로 오해된다",
  );
});

test("실시간 차량이 없으면 arrivals 는 빈 배열이다", async () => {
  const cache = new ArrivalCache(async () => ({ arrivals: [] }));

  const result = await searchRoutes(request, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: guideOneCandidate,
    getArrivals: buildGetArrivals(cache),
    now: () => "2026-08-26T18:00:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;

  assert.deepEqual(
    result.body.routes[0]?.arrivals,
    [],
    "조회는 됐고 차량만 없는 경우는 빈 배열로 구분된다",
  );
});

test("정상 조회는 도착 예정 시간을 그대로 싣는다", async () => {
  const cache = new ArrivalCache(async () => ({
    arrivals: [
      {
        predictedArrivalMinutes: 6,
        occupancy: { type: "UNAVAILABLE" as const, congestionLevel: null, remainingSeats: null },
      },
    ],
  }));

  const result = await searchRoutes(request, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: guideOneCandidate,
    getArrivals: buildGetArrivals(cache),
    now: () => "2026-08-26T18:00:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.routes[0]?.arrivals?.[0]?.predictedArrivalMinutes, 6);
});

test("두 후보가 같은 정류장·노선이면 GBIS를 한 번만 부른다", async () => {
  let calls = 0;
  const cache = new ArrivalCache(async () => {
    calls += 1;
    return { arrivals: [] };
  });

  const baseRoutes = await mockSearchRoutes(request);
  const shared = [
    { ...baseRoutes[0]!, candidateId: 1, gbisStationId: "S1", localBusId: "R1" },
    { ...baseRoutes[0]!, candidateId: 2, gbisStationId: "S1", localBusId: "R1" },
  ];

  await searchRoutes(request, {
    searchRoutes: async () => shared,
    generateRouteGuide: async () => ({
      selectedCandidates: [
        { candidateId: 1, guideMessage: "1" },
        { candidateId: 2, guideMessage: "2" },
      ],
    }),
    getArrivals: buildGetArrivals(cache),
    now: () => "2026-08-26T18:00:00+09:00",
  });

  assert.equal(calls, 1, `같은 대상인데 GBIS를 ${calls}회 불렀다`);
});
