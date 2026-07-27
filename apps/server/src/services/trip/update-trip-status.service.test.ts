import assert from "node:assert/strict";
import test from "node:test";
import { BELL_COMMAND, BELL_STATUS, TRIP_STATUS } from "@bus-ta/shared";
import {
  TripCancelledDuringUpdateError,
  TripCompletedDuringUpdateError,
  updateTripStatus,
  type TripProgressData,
} from "./update-trip-status.service.js";

// 정류장 계산 검증용 4정류장 고정 노선 (시연 fixture(DEMO_ROUTE=1551)와 분리해 테스트 안정화)
const TEST_ROUTE = {
  routeNo: "TEST-4",
  stationList: [
    { stationName: "T0", latitude: 37.49, longitude: 127.03, sequence: 0 },
    { stationName: "T1", latitude: 37.492, longitude: 127.032, sequence: 1 },
    { stationName: "T2", latitude: 37.494, longitude: 127.034, sequence: 2 },
    { stationName: "T3", latitude: 37.496, longitude: 127.036, sequence: 3 },
  ],
};

const baseTrip: TripProgressData["trip"] = {
  tripId: "trip-test-001",
  destination: "도착정류장",
  routeNo: TEST_ROUTE.routeNo,
  stationList: TEST_ROUTE.stationList,
};

const baseStatus: TripProgressData["status"] = {
  tripId: "trip-test-001",
  currentStation: null,
  nextStation: TEST_ROUTE.stationList[0]!,
  remainingStations: TEST_ROUTE.stationList.length - 1,
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
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
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
    routeNo: TEST_ROUTE.routeNo,
    currentStation: TEST_ROUTE.stationList[1],
    nextStation: TEST_ROUTE.stationList[2],
    remainingStations: 2,
    tripStatus: TRIP_STATUS.ON_BUS,
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
      currentStation: TEST_ROUTE.stationList[1],
      nextStation: TEST_ROUTE.stationList[2],
      remainingStations: 2,
      tripStatus: TRIP_STATUS.ON_BUS,
      bellStatus: BELL_STATUS.NOT_REQUESTED,
      lastRequestId: "loc-001",
      locationSource: "MOCK",
      recordedAt: "2026-07-01T14:35:00+09:00",
      updatedAt: "2026-07-01T14:35:01+09:00",
    },
    locationLog: {
      tripId: "trip-test-001",
      requestId: "loc-001",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      source: "MOCK",
      recordedAt: "2026-07-01T14:35:00+09:00",
      currentStation: TEST_ROUTE.stationList[1],
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
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-01T14:35:00+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[1]!,
          nextStation: TEST_ROUTE.stationList[2]!,
          remainingStations: 2,
          tripStatus: TRIP_STATUS.ON_BUS,
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
      latitude: TEST_ROUTE.stationList[3]!.latitude,
      longitude: TEST_ROUTE.stationList[3]!.longitude,
      recordedAt: "2026-07-01T14:35:03+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[0]!,
          nextStation: TEST_ROUTE.stationList[1]!,
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
  assert.equal(result.body.currentStation?.stationName, TEST_ROUTE.stationList[1]!.stationName);
  assert.equal((saved[0] as { locationLog: { reason: string } }).locationLog.reason, "FORWARD_JUMP_CLAMPED");
});

test("auto-generates a bell request when remainingStations becomes 1 and bell is NOT_REQUESTED", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-bell-1",
      latitude: TEST_ROUTE.stationList[2]!.latitude,
      longitude: TEST_ROUTE.stationList[2]!.longitude,
      recordedAt: "2026-07-01T14:36:00+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[1]!,
          nextStation: TEST_ROUTE.stationList[2]!,
          remainingStations: 2,
          tripStatus: TRIP_STATUS.ON_BUS,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      generateBellRequestId: () => "bell-test-001",
      now: () => "2026-07-01T14:36:01+09:00",
    },
  );

  if (result.httpStatus !== 200) {
    throw new Error("expected successful status update");
  }
  assert.equal(result.body.remainingStations, 1);
  assert.equal(result.body.shouldTriggerBell, true);
  assert.equal(result.body.bellStatus, BELL_STATUS.PENDING);
  assert.equal(result.body.bellRequestId, "bell-test-001");
  assert.equal(result.body.command, BELL_COMMAND.STOP_REQUEST);

  assert.equal(saved.length, 1);
  const savedInput = saved[0] as {
    status: { bellStatus: string };
    bellRequest: { tripId: string; bellRequestId: string; command: string; requestedAt: string } | null;
  };
  assert.equal(savedInput.status.bellStatus, BELL_STATUS.PENDING);
  assert.deepEqual(savedInput.bellRequest, {
    tripId: "trip-test-001",
    bellRequestId: "bell-test-001",
    command: BELL_COMMAND.STOP_REQUEST,
    requestedAt: "2026-07-01T14:36:01+09:00",
  });
});

test("does not generate a second bell request when bell is already PENDING", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-bell-2",
      latitude: TEST_ROUTE.stationList[2]!.latitude,
      longitude: TEST_ROUTE.stationList[2]!.longitude,
      recordedAt: "2026-07-01T14:37:00+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[1]!,
          nextStation: TEST_ROUTE.stationList[2]!,
          remainingStations: 1,
          tripStatus: TRIP_STATUS.NEAR_DESTINATION,
          bellStatus: BELL_STATUS.PENDING,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      generateBellRequestId: () => "bell-should-not-be-used",
      now: () => "2026-07-01T14:37:01+09:00",
    },
  );

  if (result.httpStatus !== 200) {
    throw new Error("expected successful status update");
  }
  assert.equal(result.body.shouldTriggerBell, false);
  assert.equal(result.body.bellStatus, BELL_STATUS.PENDING);
  assert.equal(saved.length, 1);
  const savedInput = saved[0] as { status: { bellStatus: string }; bellRequest?: unknown };
  assert.equal(savedInput.status.bellStatus, BELL_STATUS.PENDING);
  assert.equal(savedInput.bellRequest ?? null, null);
});

test("does not generate a bell request when more than one station remains", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-bell-3",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-01T14:38:00+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[0]!,
          nextStation: TEST_ROUTE.stationList[1]!,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      generateBellRequestId: () => "bell-should-not-be-used",
      now: () => "2026-07-01T14:38:01+09:00",
    },
  );

  if (result.httpStatus !== 200) {
    throw new Error("expected successful status update");
  }
  assert.equal(result.body.remainingStations, 2);
  assert.equal(result.body.shouldTriggerBell, false);
  assert.equal(result.body.bellStatus, BELL_STATUS.NOT_REQUESTED);
  const savedInput = saved[0] as { bellRequest?: unknown };
  assert.equal(savedInput.bellRequest ?? null, null);
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

test("rejects a location update after the trip was cancelled", async () => {
  let saved = false;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-cancelled-1",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-25T12:11:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          tripStatus: TRIP_STATUS.CANCELLED,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        saved = true;
      },
      now: () => "2026-07-25T12:11:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 409);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "INVALID_TRIP_STATUS",
    message: "종료된 운행의 위치는 갱신할 수 없습니다.",
    timestamp: "2026-07-25T12:11:01.000Z",
  });
  assert.equal(saved, false);
});

test("returns cached success when a duplicate requestId is replayed after the trip was cancelled", async () => {
  let saved = false;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-cancelled-dup-1",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-27T12:11:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          tripStatus: TRIP_STATUS.CANCELLED,
        },
      }),
      findLocationLogByRequestId: async () => ({
        tripId: "trip-test-001",
        requestId: "loc-cancelled-dup-1",
      }),
      saveStatusAndLocation: async () => {
        saved = true;
      },
      now: () => "2026-07-27T12:11:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.message, "이미 처리된 위치 업데이트입니다.");
  assert.equal(saved, false);
});

test("returns 409 when cancellation wins after the location status was read", async () => {
  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-cancel-race-1",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-25T12:12:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({ trip: baseTrip, status: baseStatus }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        throw new TripCancelledDuringUpdateError();
      },
      now: () => "2026-07-25T12:12:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 409);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "INVALID_TRIP_STATUS",
    message: "종료된 운행의 위치는 갱신할 수 없습니다.",
    timestamp: "2026-07-25T12:12:01.000Z",
  });
});

test("returns 409 when completion wins after the location status was read", async () => {
  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-complete-race-1",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-25T12:13:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({ trip: baseTrip, status: baseStatus }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        throw new TripCompletedDuringUpdateError();
      },
      now: () => "2026-07-25T12:13:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 409);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "INVALID_TRIP_STATUS",
    message: "종료된 운행의 위치는 갱신할 수 없습니다.",
    timestamp: "2026-07-25T12:13:01.000Z",
  });
});

test("returns 500 DB_ERROR instead of throwing when findTripProgressData fails", async () => {
  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-db-error-1",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-26T12:00:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => {
        throw new Error("Supabase network error");
      },
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {},
      now: () => "2026-07-26T12:00:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "DB_ERROR",
    message: "운행 정보를 조회하지 못했습니다.",
    timestamp: "2026-07-26T12:00:01.000Z",
  });
});

test("returns 500 DB_ERROR instead of throwing when findLocationLogByRequestId fails", async () => {
  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-db-error-2",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-26T12:01:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({ trip: baseTrip, status: baseStatus }),
      findLocationLogByRequestId: async () => {
        throw new Error("Supabase network error");
      },
      saveStatusAndLocation: async () => {},
      now: () => "2026-07-26T12:01:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "DB_ERROR",
    message: "중복 요청 확인에 실패했습니다.",
    timestamp: "2026-07-26T12:01:01.000Z",
  });
});
