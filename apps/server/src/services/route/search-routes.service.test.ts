import assert from "node:assert/strict";
import test from "node:test";
import { searchRoutes } from "./search-routes.service.js";
import { mockSearchRoutes } from "../../adapters/routes/mock-route-search.adapter.js";

const validRequest = {
  destination: "수원대",
  latitude: 37.49,
  longitude: 127.03,
};

test("returns mock route candidates for a valid request", async () => {
  const result = await searchRoutes(validRequest, {
    searchRoutes: mockSearchRoutes,
    now: () => "2026-07-01T15:10:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.success, true);
  assert.equal(result.body.destination, "수원대");
  assert.equal(result.body.routes.length, 2);
  assert.deepEqual(
    result.body.routes.map((route) => route.candidateId),
    [1, 2],
  );
  for (const route of result.body.routes) {
    assert.ok(route.routeNo);
    assert.ok(route.localBusId);
    assert.ok(route.gbisStationId);
    assert.ok(route.stationList.length >= 2);
  }
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
