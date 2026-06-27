import assert from "node:assert/strict";
import test from "node:test";
import { BELL_STATUS, DEMO_ROUTE, TRIP_STATUS } from "@bus-ta/shared";
import { createTrip } from "./create-trip.service.js";

test("creates a trip and initial status from a valid selected candidate", async () => {
  const saved: unknown[] = [];

  const result = await createTrip(
    {
      ...DEMO_ROUTE,
      destination: "도착정류장",
    },
    {
      createTripWithStatus: async (data) => {
        saved.push(data);
      },
      getPredictedArrivalMinutes: async () => 6,
      generateTripId: () => "trip-test-001",
      now: () => "2026-07-01T14:31:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 201);
  assert.deepEqual(result.body, {
    success: true,
    tripId: "trip-test-001",
    routeNo: DEMO_ROUTE.routeNo,
    localBusId: DEMO_ROUTE.localBusId,
    gbisStationId: DEMO_ROUTE.gbisStationId,
    predictedArrivalMinutes: 6,
    tripStatus: TRIP_STATUS.WAITING_BUS,
    bellStatus: BELL_STATUS.NOT_REQUESTED,
    shouldTriggerBell: false,
    createdAt: "2026-07-01T14:31:00+09:00",
    message: "선택한 노선으로 운행을 생성했습니다.",
    timestamp: "2026-07-01T14:31:00+09:00",
  });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], {
    trip: {
      tripId: "trip-test-001",
      destination: "도착정류장",
      candidateId: DEMO_ROUTE.candidateId,
      routeNo: DEMO_ROUTE.routeNo,
      localBusId: DEMO_ROUTE.localBusId,
      gbisStationId: DEMO_ROUTE.gbisStationId,
      vehicleId: null,
      boardingStation: DEMO_ROUTE.boardingStation,
      destinationStation: DEMO_ROUTE.destinationStation,
      stationList: DEMO_ROUTE.stationList,
      totalTime: null,
      totalWalk: null,
      payment: null,
      busTransitCount: null,
      busStationCount: null,
      totalDistance: null,
      intervalTime: null,
      predictedArrivalMinutes: 6,
      createdAt: "2026-07-01T14:31:00+09:00",
      updatedAt: "2026-07-01T14:31:00+09:00",
    },
    status: {
      tripId: "trip-test-001",
      currentStation: null,
      nextStation: DEMO_ROUTE.boardingStation,
      remainingStations: DEMO_ROUTE.stationList.length - 1,
      tripStatus: TRIP_STATUS.WAITING_BUS,
      bellStatus: BELL_STATUS.NOT_REQUESTED,
      lastRequestId: null,
      locationSource: null,
      recordedAt: null,
      updatedAt: "2026-07-01T14:31:00+09:00",
    },
  });
});

test("continues trip creation with null predicted arrival minutes when arrival lookup fails", async () => {
  const saved: unknown[] = [];

  const result = await createTrip(
    {
      ...DEMO_ROUTE,
      destination: "도착정류장",
    },
    {
      createTripWithStatus: async (data) => {
        saved.push(data);
      },
      getPredictedArrivalMinutes: async () => {
        throw new Error("GBIS unavailable");
      },
      generateTripId: () => "trip-test-002",
      now: () => "2026-07-01T14:31:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 201);
  assert.equal(result.body.predictedArrivalMinutes, null);
  assert.equal((saved[0] as { trip: { predictedArrivalMinutes: number | null } }).trip.predictedArrivalMinutes, null);
});

test("rejects a selected candidate when boarding station does not match the station list start", async () => {
  let called = false;

  const result = await createTrip(
    {
      ...DEMO_ROUTE,
      destination: "도착정류장",
      boardingStation: {
        ...DEMO_ROUTE.boardingStation,
        stationName: "다른 정류장",
      },
    },
    {
      createTripWithStatus: async () => {
        called = true;
      },
      getPredictedArrivalMinutes: async () => 6,
      generateTripId: () => "trip-test-003",
      now: () => "2026-07-01T14:31:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 400);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "INVALID_STATION_LIST",
    message: "boardingStation은 stationList의 첫 정류장과 일치해야 합니다.",
    timestamp: "2026-07-01T14:31:00+09:00",
  });
  assert.equal(called, false);
});
