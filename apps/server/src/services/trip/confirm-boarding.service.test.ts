import assert from "node:assert/strict";
import test from "node:test";
import { BOARDING_METHOD, TRIP_STATUS } from "@bus-ta/shared";
import { confirmBoarding } from "./confirm-boarding.service.js";

const confirmedStatus = {
  trip: {
    tripId: "trip-test-001",
    destination: "수원대학교",
    routeNo: "700-2",
    stationList: [],
  },
  status: {
    tripId: "trip-test-001",
    currentStation: null,
    nextStation: null,
    remainingStations: 3,
    tripStatus: TRIP_STATUS.ON_BUS,
    boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
    boardingConfirmedAt: "2026-08-22T01:00:00.000Z",
    bellStatus: "NOT_REQUESTED",
    bellRequestId: null,
    command: null,
    lastRequestId: null,
    locationSource: null,
    recordedAt: null,
    lastLatitude: null,
    lastLongitude: null,
    locationChangedAt: null,
    updatedAt: "2026-08-22T01:00:00.000Z",
  },
};

test("explicit voice confirmation persists USER_CONFIRMED without BLE or GPS evidence", async () => {
  const writes: unknown[] = [];
  const result = await confirmBoarding(
    "trip-test-001",
    { requestId: "boarding-voice-001", boardingMethod: BOARDING_METHOD.USER_CONFIRMED },
    {
      confirmBoarding: async (input) => {
        writes.push(input);
        return "CONFIRMED";
      },
      findTripProgressData: async () => confirmedStatus,
      now: () => "2026-08-22T01:00:00.000Z",
    },
  );

  assert.deepEqual(writes, [
    {
      tripId: "trip-test-001",
      requestId: "boarding-voice-001",
      boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
      detectedAt: null,
      confirmedAt: "2026-08-22T01:00:00.000Z",
    },
  ]);
  assert.deepEqual(result, {
    httpStatus: 200,
    body: {
      success: true,
      tripId: "trip-test-001",
      tripStatus: TRIP_STATUS.ON_BUS,
      boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
      boardingConfirmedAt: "2026-08-22T01:00:00.000Z",
      message: "버스 탑승을 확인했습니다.",
      timestamp: "2026-08-22T01:00:00.000Z",
    },
  });
});

test("rejects AUTO_DETECTED evidence whose detectedAt is after the server confirmation time", async () => {
  let called = false;
  const result = await confirmBoarding(
    "trip-test-001",
    {
      requestId: "boarding-ble-future",
      boardingMethod: BOARDING_METHOD.AUTO_DETECTED,
      detectedAt: "2026-08-22T01:00:01.000Z",
    },
    {
      confirmBoarding: async () => {
        called = true;
        return "CONFIRMED";
      },
      findTripProgressData: async () => confirmedStatus,
      now: () => "2026-08-22T01:00:00.000Z",
    },
  );

  assert.equal(called, false);
  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.success, false);
  assert.equal(result.body.errorCode, "INVALID_REQUEST");
});

test("idempotent replay returns the first writer's stored boarding evidence", async () => {
  const result = await confirmBoarding(
    "trip-test-001",
    {
      requestId: "boarding-ble-late",
      boardingMethod: BOARDING_METHOD.AUTO_DETECTED,
      detectedAt: "2026-08-22T00:59:59.000Z",
    },
    {
      confirmBoarding: async () => "ALREADY_CONFIRMED",
      findTripProgressData: async () => confirmedStatus,
      now: () => "2026-08-22T01:00:02.000Z",
    },
  );

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.boardingMethod, BOARDING_METHOD.USER_CONFIRMED);
  assert.equal(result.body.boardingConfirmedAt, "2026-08-22T01:00:00.000Z");
  assert.equal(result.body.timestamp, "2026-08-22T01:00:02.000Z");
});

for (const [outcome, httpStatus, errorCode] of [
  ["TRIP_NOT_FOUND", 404, "TRIP_NOT_FOUND"],
  ["INVALID_STATUS", 409, "INVALID_TRIP_STATUS"],
  ["INCONSISTENT", 409, "BOARDING_STATE_INCONSISTENT"],
] as const) {
  test(`maps ${outcome} to the public boarding error contract`, async () => {
    const result = await confirmBoarding(
      "trip-test-001",
      { requestId: "boarding-001", boardingMethod: BOARDING_METHOD.USER_CONFIRMED },
      {
        confirmBoarding: async () => outcome,
        findTripProgressData: async () => null,
        now: () => "2026-08-22T01:00:00.000Z",
      },
    );

    assert.equal(result.httpStatus, httpStatus);
    assert.equal(result.body.success, false);
    assert.equal(result.body.errorCode, errorCode);
  });
}

test("returns DB_ERROR when the atomic boarding write fails", async () => {
  const result = await confirmBoarding(
    "trip-test-001",
    { requestId: "boarding-001", boardingMethod: BOARDING_METHOD.USER_CONFIRMED },
    {
      confirmBoarding: async () => {
        throw new Error("database unavailable");
      },
      findTripProgressData: async () => confirmedStatus,
      now: () => "2026-08-22T01:00:00.000Z",
    },
  );

  assert.equal(result.httpStatus, 500);
  assert.equal(result.body.success, false);
  assert.equal(result.body.errorCode, "DB_ERROR");
});
