import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_BEACONS } from "@bus-ta/shared";
import { getBeaconByRoute } from "./get-beacon.service.js";
import { FixtureBeaconRepository } from "../../repositories/beacon.repository.js";

const repository = new FixtureBeaconRepository();

test("returns the mock targetBeaconId for a known routeNo", async () => {
  const demo = DEMO_BEACONS[0]!;

  const result = await getBeaconByRoute(demo.routeNo, {
    findByRouteNo: (routeNo) => repository.findByRouteNo(routeNo),
    now: () => "2026-07-01T15:00:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(result.body, {
    success: true,
    routeNo: demo.routeNo,
    targetBeaconId: demo.targetBeaconId,
    isMock: demo.isMock,
    message: "비콘 정보를 조회했습니다.",
    timestamp: "2026-07-01T15:00:00+09:00",
  });
});

test("trims surrounding whitespace from routeNo", async () => {
  const demo = DEMO_BEACONS[0]!;

  const result = await getBeaconByRoute(`  ${demo.routeNo}  `, {
    findByRouteNo: (routeNo) => repository.findByRouteNo(routeNo),
    now: () => "2026-07-01T15:00:01+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.targetBeaconId, demo.targetBeaconId);
});

test("returns 400 when routeNo is missing", async () => {
  const result = await getBeaconByRoute(undefined, {
    findByRouteNo: (routeNo) => repository.findByRouteNo(routeNo),
    now: () => "2026-07-01T15:00:02+09:00",
  });

  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "INVALID_REQUEST");
});

test("returns 404 for an unknown routeNo", async () => {
  const result = await getBeaconByRoute("nonexistent-route", {
    findByRouteNo: (routeNo) => repository.findByRouteNo(routeNo),
    now: () => "2026-07-01T15:00:03+09:00",
  });

  assert.equal(result.httpStatus, 404);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "BEACON_NOT_FOUND");
});
