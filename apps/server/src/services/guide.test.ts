import assert from "node:assert/strict";
import test from "node:test";
import type { Route } from "@bus-ta/shared";
import { selectRouteCandidates } from "./guide.js";

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

test("점수가 좋은 순서로 최대 2개만 선택한다", () => {
  const routes = [
    buildRoute({ candidateId: 1, routeNo: "느림", totalTime: 40, intervalTime: 40 }), // 60
    buildRoute({ candidateId: 2, routeNo: "가장빠름", totalTime: 10, intervalTime: 10 }), // 15
    buildRoute({ candidateId: 3, routeNo: "중간", totalTime: 20, intervalTime: 10 }), // 25
    buildRoute({ candidateId: 4, routeNo: "많이느림", totalTime: 50, intervalTime: 60 }), // 80
  ];

  const selected = selectRouteCandidates(routes);

  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((route) => route.routeNo),
    ["가장빠름", "중간"],
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
