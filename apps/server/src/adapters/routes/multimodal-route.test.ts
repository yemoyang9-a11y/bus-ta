import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { RouteCandidateSchema } from "@bus-ta/shared";
import { searchRoutes } from "./hyorin-route-search.adapter.js";

// Synthetic ODsay/Kakao fixtures: scope and normalization, not a live route validation.
const request = { destination: "시험 목적지", latitude: 37, longitude: 127 };
function bus(no: string, start = "탑승", end = "하차") {
  return { trafficType: 2, startName: start, endName: end, startLocalStationID: `station-${no}`,
    stationCount: 1, intervalTime: 10, lane: [{ busNo: no, busLocalBlID: `route-${no}` }],
    passStopList: { stations: [
      { stationName: start, x: "127", y: "37" },
      { stationName: end, x: "127.001", y: "37.001" },
    ] } };
}
const walk = { trafficType: 3, sectionTime: 2 };
const subway = { trafficType: 1, startName: "환승역", endName: "마지막역", lane: [{ name: "1호선" }], sectionTime: 10 };
function path(subPath: unknown[], pathType = 2) {
  return { pathType, info: { totalTime: 30 }, subPath };
}
function stub(t: import("node:test").TestContext, paths: unknown[], scope?: string) {
  const before = process.env.ROUTE_SEARCH_SCOPE;
  if (scope === undefined) delete process.env.ROUTE_SEARCH_SCOPE;
  else process.env.ROUTE_SEARCH_SCOPE = scope;
  t.after(() => { if (before === undefined) delete process.env.ROUTE_SEARCH_SCOPE; else process.env.ROUTE_SEARCH_SCOPE = before; });
  t.mock.method(axios, "get", async (url: string) => {
    if (url.includes("dapi.kakao.com")) return { data: { documents: [{ x: "127.001", y: "37.001" }] } };
    if (url.includes("api.odsay.com")) return { data: { result: { path: paths } } };
    throw new Error("unexpected upstream");
  });
}

test("default scope returns only direct bus and preserves each lane", async (t) => {
  const direct = bus("10"); direct.lane.push({ busNo: "11", busLocalBlID: "route-11" });
  stub(t, [path([walk, direct, walk]), path([bus("20"), bus("30")]), path([subway, bus("40")], 3)]);
  const routes = await searchRoutes(request);
  assert.deepEqual(routes.map(r => r.routeNo), ["10", "11"]);
  for (const route of routes) {
    assert.equal(route.routeMode, "DIRECT_BUS"); assert.equal(route.tripSupported, true);
    assert.deepEqual(route.segments?.map(s => s.mode), ["WALK", "BUS", "WALK"]);
    assert.equal(RouteCandidateSchema.safeParse(route).success, true);
  }
});

test("multimodal preserves ordered segments and excludes subway-only", async (t) => {
  stub(t, [path([walk, subway, walk, bus("20"), walk], 3), path([walk, subway, walk], 1)], "MULTIMODAL");
  const routes = await searchRoutes(request);
  assert.equal(routes.length, 1);
  const route = routes[0]!;
  assert.equal(route.routeMode, "MULTIMODAL"); assert.equal(route.tripSupported, false);
  assert.deepEqual(route.segments?.map(s => s.mode), ["WALK", "SUBWAY", "WALK", "BUS", "WALK"]);
  assert.deepEqual(route.segments?.[1]?.lineNames, ["1호선"]);
  assert.equal(RouteCandidateSchema.safeParse(route).success, true);
  assert.deepEqual(RouteCandidateSchema.parse(route).segments, route.segments);
  assert.doesNotMatch(JSON.stringify(route), /pathType|trafficType/);
});

test("three bus transfers keep first bus stationList and the whole journey in segments", async (t) => {
  stub(t, [path([bus("10", "첫탑승", "첫하차"), walk, bus("20", "둘째탑승", "둘째하차"), bus("30", "셋째탑승", "최종하차")])], "MULTIMODAL");
  const [route] = await searchRoutes(request);
  assert.ok(route); assert.equal(route.tripSupported, false);
  assert.equal(route.busTransitCount, 3);
  assert.deepEqual(route.stationList.map(s => s.stationName), ["첫탑승", "첫하차"]);
  assert.equal(route.destinationStation.stationName, "첫하차");
  assert.equal(route.segments?.at(-1)?.endName, "최종하차");
});

test("bus then subway keeps guide candidate even when first bus ends far from destination", async (t) => {
  const first = bus("10"); first.passStopList.stations[1]!.y = "37.1";
  stub(t, [path([first, subway], 3)], "MULTIMODAL");
  const routes = await searchRoutes(request);
  assert.equal(routes.length, 1); assert.equal(routes[0]?.tripSupported, false);
});

test("invalid transfer bus identifiers or stop coordinates discard the candidate", async (t) => {
  const noId = bus("20"); noId.lane[0]!.busLocalBlID = "";
  const noCoord = bus("30"); noCoord.passStopList.stations[0]!.x = "bad";
  stub(t, [path([bus("10"), noId]), path([bus("10"), noCoord])], "MULTIMODAL");
  assert.deepEqual(await searchRoutes(request), []);
});

test("Kakao missing destination error does not expose the query", async (t) => {
  t.mock.method(axios, "get", async () => ({ data: { documents: [] } }));
  await assert.rejects(() => searchRoutes(request), error => {
    assert.doesNotMatch(String(error), /시험 목적지/); return true;
  });
});
