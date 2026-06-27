import assert from "node:assert/strict";
import test from "node:test";
import { BELL_STATUS, DEMO_ROUTE, TRIP_STATUS } from "@bus-ta/shared";
import { updateTripStatus, type TripProgressData } from "./update-trip-status.service.js";

const baseTrip: TripProgressData["trip"] = {
  tripId: "trip-test-001",
  destination: "도착정류장",
  routeNo: DEMO_ROUTE.routeNo,
  stationList: DEMO_ROUTE.stationList,
};

const baseStatus: TripProgressData["status"] = {
  tripId: "trip-test-001",
  currentStation: null,
  nextStation: DEMO_ROUTE.stationList[0]!,
  remainingStations: DEMO_ROUTE.stationList.length - 1,
  tripStatus: TRIP_STATUS.WAITING_BUS,
  bellStatus: BELL_STATUS.NOT_REQUESTED,
  bellRequestId: null,
  command: null,
  lastRequestId: null,
  locationSource: null,
  recordedAt: null,
  updatedAt: "2026-07-01T14:31:00+09:00",
};

test("updates current station, next station, remainingStations, and tripStatus from a new location", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-001",
      latitude: DEMO_ROUTE.stationList[1]!.latitude,
      longitude: DEMO_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-01T14:35:00+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({ trip: baseTrip, status: baseStatus }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      now: () => "2026-07-01T14:35:01+09:00",
    },
  );

  assert.equal(result.httpStatus, 200);
  assert.deepEqual(result.body, {
    success: true,
    tripId: "trip-test-001",
    destination: "도착정류장",
    routeNo: DEMO_ROUTE.routeNo,
    currentStation: DEMO_ROUTE.stationList[1],
    nextStation: DEMO_ROUTE.stationList[2],
    remainingStations: 2,
    tripStatus: TRIP_STATUS.NEAR_DESTINATION,
    bellStatus: BELL_STATUS.NOT_REQUESTED,
    shouldTriggerBell: false,
    command: null,
    guideMessage: "하차까지 두 정류장 남았습니다. 하차 준비를 시작하세요.",
    source: "MOCK",
    message: "이동 상태를 갱신했습니다.",
    timestamp: "2026-07-01T14:35:01+09:00",
  });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], {
    status: {
      tripId: "trip-test-001",
      currentStation: DEMO_ROUTE.stationList[1],
      nextStation: DEMO_ROUTE.stationList[2],
      remainingStations: 2,
      tripStatus: TRIP_STATUS.NEAR_DESTINATION,
      bellStatus: BELL_STATUS.NOT_REQUESTED,
      lastRequestId: "loc-001",
      locationSource: "MOCK",
      recordedAt: "2026-07-01T14:35:00+09:00",
      updatedAt: "2026-07-01T14:35:01+09:00",
    },
    locationLog: {
      tripId: "trip-test-001",
      requestId: "loc-001",
      latitude: DEMO_ROUTE.stationList[1]!.latitude,
      longitude: DEMO_ROUTE.stationList[1]!.longitude,
      source: "MOCK",
      recordedAt: "2026-07-01T14:35:00+09:00",
      currentStation: DEMO_ROUTE.stationList[1],
      remainingStations: 2,
      locationAccepted: true,
      reason: null,
    },
  });
});

test("returns current status without saving a new location when requestId is duplicated", async () => {
  let saved = false;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-001",
      latitude: DEMO_ROUTE.stationList[1]!.latitude,
      longitude: DEMO_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-01T14:35:00+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: DEMO_ROUTE.stationList[1]!,
          nextStation: DEMO_ROUTE.stationList[2]!,
          remainingStations: 2,
          tripStatus: TRIP_STATUS.NEAR_DESTINATION,
          lastRequestId: "loc-001",
        },
      }),
      findLocationLogByRequestId: async () => ({
        tripId: "trip-test-001",
        requestId: "loc-001",
      }),
      saveStatusAndLocation: async () => {
        saved = true;
      },
      now: () => "2026-07-01T14:35:02+09:00",
    },
  );

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.message, "이미 처리된 위치 업데이트입니다.");
  assert.equal(result.body.remainingStations, 2);
  assert.equal(saved, false);
});

test("clamps a multi-station forward jump to one station", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-002",
      latitude: DEMO_ROUTE.stationList[3]!.latitude,
      longitude: DEMO_ROUTE.stationList[3]!.longitude,
      recordedAt: "2026-07-01T14:35:03+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: DEMO_ROUTE.stationList[0]!,
          nextStation: DEMO_ROUTE.stationList[1]!,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      now: () => "2026-07-01T14:35:04+09:00",
    },
  );

  if (result.httpStatus !== 200) {
    throw new Error("expected successful status update");
  }
  assert.equal(result.body.currentStation?.stationName, DEMO_ROUTE.stationList[1]!.stationName);
  assert.equal((saved[0] as { locationLog: { reason: string } }).locationLog.reason, "FORWARD_JUMP_CLAMPED");
});

test("rejects an unknown tripId", async () => {
  const result = await updateTripStatus(
    "missing-trip",
    {
      requestId: "loc-404",
      latitude: 37.49,
      longitude: 127.03,
      recordedAt: "2026-07-01T14:35:00+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => null,
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {},
      now: () => "2026-07-01T14:35:05+09:00",
    },
  );

  assert.equal(result.httpStatus, 404);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "TRIP_NOT_FOUND",
    message: "운행 정보를 찾을 수 없습니다.",
    timestamp: "2026-07-01T14:35:05+09:00",
  });
});
