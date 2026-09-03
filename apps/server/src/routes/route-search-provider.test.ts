import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_BEACONS } from "@bus-ta/shared";
import { FixtureBeaconRepository } from "../repositories/beacon.repository.js";
import { getRouteSearchProvider } from "./route-search-provider.js";

const request = {
  destination: "어디든",
  latitude: 37.213789,
  longitude: 126.979772,
};

test("mock 모드는 고정 시연 노선과 DB 비콘 매칭을 반환한다", async () => {
  const provider = getRouteSearchProvider({ ROUTE_SEARCH_MODE: "MOCK" });
  const routes = await provider(request);
  const routeNos = [...new Set(routes.map((route) => route.routeNo))];
  const beacon = await new FixtureBeaconRepository().findByRouteNo(routeNos[0] ?? "");

  assert.deepEqual(routeNos, [DEMO_BEACONS[0]!.routeNo]);
  assert.equal(beacon?.targetBeaconId, DEMO_BEACONS[0]!.targetBeaconId);
  assert.equal(beacon?.targetBeaconId, "BUS_1551_001");
});

test("ROUTE_SEARCH_MODE가 MOCK이 아니면 실제 검색 제공자를 사용한다", () => {
  const provider = getRouteSearchProvider({ ROUTE_SEARCH_MODE: "REAL" });

  assert.notEqual(provider, getRouteSearchProvider({ ROUTE_SEARCH_MODE: "MOCK" }));
});
