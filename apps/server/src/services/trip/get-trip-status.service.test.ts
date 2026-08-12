import assert from "node:assert/strict";
import test from "node:test";
import { BELL_COMMAND, BELL_STATUS, DEMO_ROUTE, TRIP_STATUS } from "@bus-ta/shared";
import { getTripStatus } from "./get-trip-status.service.js";
import type { TripProgressData } from "./update-trip-status.service.js";

const baseTrip: TripProgressData["trip"] = {
  tripId: "trip-test-001",
  destination: "도착정류장",
  routeNo: DEMO_ROUTE.routeNo,
  stationList: DEMO_ROUTE.stationList,
};

const baseStatus: TripProgressData["status"] = {
  tripId: "trip-test-001",
  currentStation: DEMO_ROUTE.stationList[1]!,
  nextStation: DEMO_ROUTE.stationList[2]!,
  remainingStations: 2,
  tripStatus: TRIP_STATUS.ON_BUS,
  bellStatus: BELL_STATUS.NOT_REQUESTED,
  bellRequestId: null,
  command: null,
  lastRequestId: "loc-010",
  locationSource: "MOCK",
  recordedAt: "2026-07-01T14:35:00+09:00",
  updatedAt: "2026-07-01T14:35:01+09:00",
};

test("returns the current trip status without triggering a bell", async () => {
  const result = await getTripStatus("trip-test-001", {
    findTripProgressData: async () => ({ trip: baseTrip, status: baseStatus }),
    now: () => "2026-07-01T14:36:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.tripStatus, TRIP_STATUS.ON_BUS);
  assert.equal(result.body.remainingStations, 2);
  assert.equal(result.body.bellStatus, BELL_STATUS.NOT_REQUESTED);
  assert.equal(result.body.shouldTriggerBell, false);
  assert.equal(result.body.command, null);
  assert.equal("bellRequestId" in result.body, false);
});

test("returns bellRequestId and command when a bell request is pending", async () => {
  const result = await getTripStatus("trip-test-001", {
    findTripProgressData: async () => ({
      trip: baseTrip,
      status: {
        ...baseStatus,
        currentStation: DEMO_ROUTE.stationList[2]!,
        nextStation: DEMO_ROUTE.stationList[3]!,
        remainingStations: 1,
        bellStatus: BELL_STATUS.PENDING,
        bellRequestId: "bell-test-001",
        command: BELL_COMMAND.STOP_REQUEST,
      },
    }),
    now: () => "2026-07-01T14:37:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.bellStatus, BELL_STATUS.PENDING);
  assert.equal(result.body.bellRequestId, "bell-test-001");
  // 조회 응답은 command 를 노출하지 않는다(항상 null). 명령은 PATCH 자동 생성 응답에서만.
  assert.equal(result.body.command, null);
  assert.equal(result.body.shouldTriggerBell, false);
  assert.equal(result.body.guideMessage, "하차벨 요청 결과를 기다리고 있습니다.");
});

test("returns a cancellation guide message for a cancelled trip", async () => {
  const result = await getTripStatus("trip-test-001", {
    findTripProgressData: async () => ({
      trip: baseTrip,
      status: {
        ...baseStatus,
        tripStatus: TRIP_STATUS.CANCELLED,
      },
    }),
    now: () => "2026-07-25T12:12:00.000Z",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.tripStatus, TRIP_STATUS.CANCELLED);
  assert.equal(result.body.guideMessage, "운행 안내가 종료되었습니다.");
});

test("returns 404 for an unknown tripId", async () => {
  const result = await getTripStatus("missing-trip", {
    findTripProgressData: async () => null,
    now: () => "2026-07-01T14:38:00+09:00",
  });

  assert.equal(result.httpStatus, 404);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "TRIP_NOT_FOUND",
    message: "운행 정보를 찾을 수 없습니다.",
    timestamp: "2026-07-01T14:38:00+09:00",
  });
});

test("returns 500 DB_ERROR when the trip status repository fails", async () => {
  const result = await getTripStatus("trip-test-001", {
    findTripProgressData: async () => {
      throw new Error("Supabase unavailable");
    },
    now: () => "2026-07-01T14:39:00+09:00",
  });

  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "DB_ERROR",
    message: "운행 상태를 조회하지 못했습니다.",
    timestamp: "2026-07-01T14:39:00+09:00",
  });
});
