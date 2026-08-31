import assert from "node:assert/strict";
import test from "node:test";
import type { Route } from "@bus-ta/shared";
import { ROUTE_CANDIDATE_LIMIT, selectRouteCandidates } from "./guide.js";

function buildRoute(overrides: Partial<Route> & Pick<Route, "candidateId" | "routeNo">): Route {
  return {
    localBusId: `local-${overrides.candidateId}`,
    gbisStationId: "233000575",
    boardingStation: { stationName: "수원대학교", latitude: 37.213789, longitude: 126.979749 },
    destinationStation: { stationName: "병점역후문", latitude: 37.20601, longitude: 127.032047 },
    stationList: [
      { stationName: "수원대학교", latitude: 37.213789, longitude: 126.979749, sequence: 0 },
      { stationName: "병점역후문", latitude: 37.20601, longitude: 127.032047, sequence: 1 },
    ],
    ...overrides,
  };
}

test("배차간격이 길면 이동시간이 짧아도 합산 점수에서 밀린다", () => {
  // A: 15 + 40/2 = 35분, B: 30 + 5/2 = 32.5분
  // 이동시간만 보면 A가 이기지만, 평균 대기시간까지 더하면 B가 먼저 도착한다.
  const routeA = buildRoute({ candidateId: 1, routeNo: "A", totalTime: 15, intervalTime: 40 });
  const routeB = buildRoute({ candidateId: 2, routeNo: "B", totalTime: 30, intervalTime: 5 });

  const selected = selectRouteCandidates([routeA, routeB]);

  assert.deepEqual(
    selected.map((route) => route.routeNo),
    ["B", "A"],
  );
});

test("배차간격이 짧으면 이동시간이 조금 길어도 앞선다", () => {
  // A: 20 + 30/2 = 35분, B: 24 + 6/2 = 27분
  const routeA = buildRoute({ candidateId: 1, routeNo: "A", totalTime: 20, intervalTime: 30 });
  const routeB = buildRoute({ candidateId: 2, routeNo: "B", totalTime: 24, intervalTime: 6 });

  const selected = selectRouteCandidates([routeA, routeB]);

  assert.equal(selected[0]?.routeNo, "B");
});

test("intervalTime 이 없는 후보는 대기시간 0분이 아니라 후순위로 밀린다", () => {
  const withoutInterval = buildRoute({ candidateId: 1, routeNo: "노정보없음", totalTime: 5 });
  const withInterval = buildRoute({
    candidateId: 2,
    routeNo: "정보있음",
    totalTime: 30,
    intervalTime: 10,
  });

  const selected = selectRouteCandidates([withoutInterval, withInterval]);

  assert.equal(selected[0]?.routeNo, "정보있음");
});

test("totalTime 이 없는 후보도 후순위로 밀린다", () => {
  const withoutTotalTime = buildRoute({ candidateId: 1, routeNo: "노정보없음", intervalTime: 5 });
  const complete = buildRoute({
    candidateId: 2,
    routeNo: "정보있음",
    totalTime: 40,
    intervalTime: 20,
  });

  const selected = selectRouteCandidates([withoutTotalTime, complete]);

  assert.equal(selected[0]?.routeNo, "정보있음");
});

test("합산 점수가 같으면 도보 거리가 짧은 후보가 앞선다", () => {
  // 둘 다 10 + 20/2 = 20분
  const farWalk = buildRoute({
    candidateId: 1,
    routeNo: "먼도보",
    totalTime: 10,
    intervalTime: 20,
    totalWalk: 500,
  });
  const nearWalk = buildRoute({
    candidateId: 2,
    routeNo: "가까운도보",
    totalTime: 10,
    intervalTime: 20,
    totalWalk: 100,
  });

  const selected = selectRouteCandidates([farWalk, nearWalk]);

  assert.equal(selected[0]?.routeNo, "가까운도보");
});

test("점수가 좋은 순서로 정렬해서 돌려준다", () => {
  const routes = [
    buildRoute({ candidateId: 1, routeNo: "느림", totalTime: 40, intervalTime: 40 }), // 60
    buildRoute({ candidateId: 2, routeNo: "가장빠름", totalTime: 10, intervalTime: 10 }), // 15
    buildRoute({ candidateId: 3, routeNo: "중간", totalTime: 20, intervalTime: 10 }), // 25
    buildRoute({ candidateId: 4, routeNo: "많이느림", totalTime: 50, intervalTime: 60 }), // 80
  ];

  const selected = selectRouteCandidates(routes);

  assert.deepEqual(
    selected.map((route) => route.routeNo),
    ["가장빠름", "중간", "느림", "많이느림"],
  );
});

// "다른 버스 없어요?" 에 재검색 없이 다음 순위를 안내하려면 상위 2개만 남기고
// 버려서는 안 된다. 아래 세 테스트는 3위 이후가 (1) 사라지지 않고
// (2) 점수 순서 그대로 오며 (3) 상한을 넘지 않는다는 것을 고정한다.
test("3위 이후 후보도 버리지 않고 점수 순서 그대로 돌려준다", () => {
  const routes = [
    buildRoute({ candidateId: 1, routeNo: "5위", totalTime: 50, intervalTime: 20 }), // 60
    buildRoute({ candidateId: 2, routeNo: "1위", totalTime: 10, intervalTime: 10 }), // 15
    buildRoute({ candidateId: 3, routeNo: "4위", totalTime: 30, intervalTime: 30 }), // 45
    buildRoute({ candidateId: 4, routeNo: "2위", totalTime: 20, intervalTime: 10 }), // 25
    buildRoute({ candidateId: 5, routeNo: "3위", totalTime: 25, intervalTime: 20 }), // 35
  ];

  const selected = selectRouteCandidates(routes);

  assert.deepEqual(
    selected.map((route) => route.routeNo),
    ["1위", "2위", "3위", "4위", "5위"],
  );
});

test("후보가 상한보다 많으면 상한까지만 돌려주고 그 순서도 점수순이다", () => {
  // 점수를 일부러 뒤섞어 넣는다. 상한으로 자르기 전에 정렬이 끝나 있어야
  // 잘려 나가는 쪽이 항상 점수가 나쁜 후보가 된다.
  const routes = Array.from({ length: ROUTE_CANDIDATE_LIMIT + 5 }, (_unused, index) => {
    const rank = (index * 7) % (ROUTE_CANDIDATE_LIMIT + 5); // 0..14 를 뒤섞은 순열
    return buildRoute({
      candidateId: index + 1,
      routeNo: `순위${String(rank).padStart(2, "0")}`,
      totalTime: rank,
      intervalTime: 0,
    });
  });

  const selected = selectRouteCandidates(routes);

  assert.equal(selected.length, ROUTE_CANDIDATE_LIMIT);
  assert.deepEqual(
    selected.map((route) => route.routeNo),
    Array.from({ length: ROUTE_CANDIDATE_LIMIT }, (_unused, i) => `순위${String(i).padStart(2, "0")}`),
  );
});

test("중복 제거 후 상한보다 적게 남으면 남은 만큼만 돌려준다", () => {
  // 실제 캡처(수원대→병점)에서 서로 다른 노선은 34, 34-1, 46, 1000 네 개였다.
  // 상한이 10이어도 없는 후보를 만들어 채우지 않는다.
  const routes = [
    buildRoute({ candidateId: 1, routeNo: "34", totalTime: 26, intervalTime: 30 }), // 41
    buildRoute({ candidateId: 2, routeNo: "34", totalTime: 90, intervalTime: 30 }), // 중복
    buildRoute({ candidateId: 3, routeNo: "34-1", totalTime: 28, intervalTime: 40 }), // 48
    buildRoute({ candidateId: 4, routeNo: "46", totalTime: 30, intervalTime: 60 }), // 60
    buildRoute({ candidateId: 5, routeNo: "1000", totalTime: 18, intervalTime: 50 }), // 43
  ];

  const selected = selectRouteCandidates(routes);

  assert.deepEqual(
    selected.map((route) => route.routeNo),
    ["34", "1000", "34-1", "46"],
  );
});

test("같은 노선 번호가 여러 번 오면 하나만 남긴다", () => {
  const routes = [
    buildRoute({ candidateId: 1, routeNo: "34", totalTime: 20, intervalTime: 10 }),
    buildRoute({ candidateId: 2, routeNo: "34", totalTime: 20, intervalTime: 10 }),
    buildRoute({ candidateId: 3, routeNo: "35", totalTime: 30, intervalTime: 10 }),
  ];

  const selected = selectRouteCandidates(routes);

  assert.deepEqual(
    selected.map((route) => route.routeNo),
    ["34", "35"],
  );
});

test("같은 노선 번호 중에서는 느린 후보가 앞에 와도 빠른 후보가 남는다", () => {
  // 중복 제거를 정렬보다 먼저 하면 입력 순서상 앞에 있는 90분짜리가 남고
  // 뒤에 있는 15분짜리는 점수 비교도 받지 못한 채 사라진다.
  const routes = [
    buildRoute({ candidateId: 1, routeNo: "34", totalTime: 90, intervalTime: 10 }), // 95
    buildRoute({ candidateId: 2, routeNo: "34", totalTime: 15, intervalTime: 10 }), // 20
    buildRoute({ candidateId: 3, routeNo: "35", totalTime: 30, intervalTime: 10 }), // 35
  ];

  const selected = selectRouteCandidates(routes);

  assert.deepEqual(
    selected.map((route) => route.candidateId),
    [2, 3],
  );
  assert.equal(selected[0]?.totalTime, 15);
});

test("중복 노선이 밀려나도 그 자리를 다른 노선이 채운다", () => {
  const routes = [
    buildRoute({ candidateId: 1, routeNo: "34", totalTime: 90, intervalTime: 10 }), // 95
    buildRoute({ candidateId: 2, routeNo: "34", totalTime: 10, intervalTime: 10 }), // 15
    buildRoute({ candidateId: 3, routeNo: "35", totalTime: 12, intervalTime: 10 }), // 17
    buildRoute({ candidateId: 4, routeNo: "36", totalTime: 40, intervalTime: 10 }), // 45
  ];

  const selected = selectRouteCandidates(routes);

  // 중복으로 지워진 34번(candidateId 1)이 빈자리로 남지 않고 36번까지 이어진다.
  assert.deepEqual(
    selected.map((route) => route.routeNo),
    ["34", "35", "36"],
  );
  // 같은 34번 중에서는 느린 쪽(candidateId 1)이 아니라 빠른 쪽이 살아남는다.
  assert.equal(selected[0]?.candidateId, 2);
});
