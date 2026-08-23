import assert from "node:assert/strict";
import test from "node:test";
import { BELL_STATUS, BOARDING_METHOD, DEMO_ROUTE, TRIP_STATUS } from "@bus-ta/shared";
import { endTrip } from "./end-trip.service.js";
import type { TripProgressData } from "./update-trip-status.service.js";

const activeTrip: TripProgressData = {
  trip: {
    tripId: "trip-test-001",
    destination: "수원대학교",
    routeNo: DEMO_ROUTE.routeNo,
    stationList: DEMO_ROUTE.stationList,
  },
  status: {
    tripId: "trip-test-001",
    currentStation: DEMO_ROUTE.stationList[1]!,
    nextStation: DEMO_ROUTE.stationList[2]!,
    remainingStations: 2,
    tripStatus: TRIP_STATUS.ON_BUS,
    boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
    boardingConfirmedAt: "2026-07-25T11:59:00.000Z",
    bellStatus: BELL_STATUS.NOT_REQUESTED,
    bellRequestId: null,
    command: null,
    lastRequestId: "loc-001",
    locationSource: "GPS",
    recordedAt: "2026-07-25T12:00:00.000Z",
    updatedAt: "2026-07-25T12:00:01.000Z",
  },
};

test("cancels an active trip and persists CANCELLED", async () => {
  const saved: Array<{ tripId: string; tripStatus: string; updatedAt: string }> = [];

  const result = await endTrip("trip-test-001", { action: "CANCEL" }, {
    findTripProgressData: async () => activeTrip,
    saveTripStatus: async (data) => {
      saved.push(data);
      return "CANCELLED";
    },
    now: () => "2026-07-25T12:05:00.000Z",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(result.body, {
    success: true,
    tripId: "trip-test-001",
    tripStatus: "CANCELLED",
    message: "운행 안내를 종료했습니다.",
    timestamp: "2026-07-25T12:05:00.000Z",
  });
  assert.deepEqual(saved, [
    {
      tripId: "trip-test-001",
      tripStatus: "CANCELLED",
      updatedAt: "2026-07-25T12:05:00.000Z",
    },
  ]);
});

test("returns the existing CANCELLED state without saving again", async () => {
  let saved = false;

  const result = await endTrip("trip-test-001", { action: "CANCEL" }, {
    findTripProgressData: async () => ({
      ...activeTrip,
      status: { ...activeTrip.status, tripStatus: "CANCELLED" },
    }),
    saveTripStatus: async () => {
      saved = true;
      return "CANCELLED";
    },
    now: () => "2026-07-25T12:06:00.000Z",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.tripStatus, "CANCELLED");
  assert.equal(result.body.message, "이미 종료된 운행 안내입니다.");
  assert.equal(saved, false);
});

test("rejects cancellation after the trip is completed", async () => {
  const result = await endTrip("trip-test-001", { action: "CANCEL" }, {
    findTripProgressData: async () => ({
      ...activeTrip,
      status: { ...activeTrip.status, tripStatus: TRIP_STATUS.TRIP_DONE },
    }),
    saveTripStatus: async () => {
      throw new Error("should not save");
    },
    now: () => "2026-07-25T12:07:00.000Z",
  });

  assert.equal(result.httpStatus, 409);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "INVALID_TRIP_STATUS",
    message: "이미 완료된 운행은 취소할 수 없습니다.",
    timestamp: "2026-07-25T12:07:00.000Z",
  });
});

test("rejects an invalid cancellation request", async () => {
  const result = await endTrip("trip-test-001", {}, {
    findTripProgressData: async () => {
      throw new Error("should not read");
    },
    saveTripStatus: async () => {
      throw new Error("should not save");
    },
    now: () => "2026-07-25T12:08:00.000Z",
  });

  assert.equal(result.httpStatus, 400);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "INVALID_REQUEST");
});

test("returns 404 for an unknown trip", async () => {
  const result = await endTrip("missing-trip", { action: "CANCEL" }, {
    findTripProgressData: async () => null,
    saveTripStatus: async () => {
      throw new Error("should not save");
    },
    now: () => "2026-07-25T12:09:00.000Z",
  });

  assert.equal(result.httpStatus, 404);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "TRIP_NOT_FOUND");
});

test("returns 500 when cancellation cannot be persisted", async () => {
  const result = await endTrip("trip-test-001", { action: "CANCEL" }, {
    findTripProgressData: async () => activeTrip,
    saveTripStatus: async () => {
      throw new Error("database down");
    },
    now: () => "2026-07-25T12:10:00.000Z",
  });

  assert.equal(result.httpStatus, 500);
  assert.equal(result.body.success, false);
  if (result.body.success) return;
  assert.equal(result.body.errorCode, "DB_ERROR");
});

test("returns 409 when the trip completes while cancellation is being saved", async () => {
  const result = await endTrip("trip-test-001", { action: "CANCEL" }, {
    findTripProgressData: async () => activeTrip,
    saveTripStatus: async () => "TRIP_DONE",
    now: () => "2026-07-25T12:11:00.000Z",
  });

  assert.equal(result.httpStatus, 409);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "INVALID_TRIP_STATUS",
    message: "이미 완료된 운행은 취소할 수 없습니다.",
    timestamp: "2026-07-25T12:11:00.000Z",
  });
});

test("returns the existing state when another cancellation finishes first", async () => {
  const result = await endTrip("trip-test-001", { action: "CANCEL" }, {
    findTripProgressData: async () => activeTrip,
    saveTripStatus: async () => "ALREADY_CANCELLED",
    now: () => "2026-07-25T12:12:00.000Z",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.tripStatus, TRIP_STATUS.CANCELLED);
  assert.equal(result.body.message, "이미 종료된 운행 안내입니다.");
});
