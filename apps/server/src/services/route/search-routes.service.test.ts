import assert from "node:assert/strict";
import test from "node:test";
import type { Route } from "@bus-ta/shared";
import { searchRoutes } from "./search-routes.service.js";
import { mockSearchRoutes } from "../../adapters/routes/mock-route-search.adapter.js";

const validRequest = {
  destination: "수원대",
  latitude: 37.49,
  longitude: 127.03,
};

test("returns guided route candidates for a valid request", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: async () => ({
      selectedCandidates: [
        { candidateId: 2, guideMessage: "2번 후보 안내입니다." },
        { candidateId: 1, guideMessage: "1번 후보 안내입니다." },
      ],
    }),
    now: () => "2026-07-01T15:10:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.success, true);
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [2, 1],
  );
  assert.deepEqual(
    result.body.routes.map((route) => route.guideMessage),
    ["2번 후보 안내입니다.", "1번 후보 안내입니다."],
  );
  assert.equal(result.body.routes[0]?.recommendationReason, undefined);
});

test("limits guided route candidates to at most 2", async () => {
  const baseRoutes = await mockSearchRoutes(validRequest);
  const firstRoute = baseRoutes[0];
  assert.ok(firstRoute);

  const routes: Route[] = [
    ...baseRoutes,
    { ...firstRoute, candidateId: 3, routeNo: "3" },
  ];

  const result = await searchRoutes(validRequest, {
    searchRoutes: async () => routes,
    generateRouteGuide: async () => ({
      selectedCandidates: [
        { candidateId: 1, guideMessage: "1번 후보 안내입니다." },
        { candidateId: 2, guideMessage: "2번 후보 안내입니다." },
        { candidateId: 3, guideMessage: "3번 후보 안내입니다." },
      ],
    }),
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.routes.length, 2);
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [1, 2],
  );
});

test("falls back to the first 2 routes when guide selection is empty", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: async () => ({ selectedCandidates: [] }),
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [1, 2],
  );
});

test("falls back when guide returns unknown candidate ids", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: mockSearchRoutes,
    generateRouteGuide: async () => ({
      selectedCandidates: [{ candidateId: 999, guideMessage: "없는 후보입니다." }],
    }),
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [1, 2],
  );
});

test("returns 400 for an invalid request", async () => {
  const result = await searchRoutes(
    { destination: "", latitude: 37.49, longitude: 127.03 },
    { searchRoutes: mockSearchRoutes, now: () => "2026-07-01T15:10:01+09:00" },
  );

  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "INVALID_REQUEST");
});

test("returns 502 when the route search provider throws", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: async () => {
      throw new Error("provider down");
    },
    now: () => "2026-07-01T15:10:02+09:00",
  });

  assert.equal(result.httpStatus, 502);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "ROUTE_SEARCH_FAILED");
});

test("returns an empty candidate list message when the provider has no matches", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: async () => [],
    now: () => "2026-07-01T15:10:03+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.routes.length, 0);
  assert.equal(result.body.message, "조건에 맞는 노선 후보가 없습니다.");
});
