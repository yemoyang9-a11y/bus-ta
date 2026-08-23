import assert from "node:assert/strict";
import test from "node:test";
import { BELL_COMMAND, BELL_STATUS, BOARDING_METHOD, TRIP_STATUS } from "@bus-ta/shared";
import {
  DuplicateLocationRequestError,
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
  boardingMethod: null,
  boardingConfirmedAt: null,
  bellStatus: BELL_STATUS.NOT_REQUESTED,
  bellRequestId: null,
  command: null,
  lastRequestId: null,
  locationSource: null,
  recordedAt: null,
  updatedAt: "2026-07-01T14:31:00+09:00",
};

const confirmedBoarding = {
  boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
  boardingConfirmedAt: "2026-07-01T14:34:00+09:00",
} as const;

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
    tripStatus: TRIP_STATUS.WAITING_BUS,
    boardingMethod: null,
    boardingConfirmedAt: null,
    bellStatus: BELL_STATUS.NOT_REQUESTED,
    shouldTriggerBell: false,
    command: null,
    guideMessage: "버스 탑승을 기다리고 있습니다.",
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
      tripStatus: TRIP_STATUS.WAITING_BUS,
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

test("marks the trip TRIP_DONE when the destination station is reached", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-destination-1",
      latitude: TEST_ROUTE.stationList[3]!.latitude,
      longitude: TEST_ROUTE.stationList[3]!.longitude,
      recordedAt: "2026-07-01T14:35:10+09:00",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[2]!,
          nextStation: TEST_ROUTE.stationList[3]!,
          remainingStations: 1,
          ...confirmedBoarding,
          tripStatus: TRIP_STATUS.NEAR_DESTINATION,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      now: () => "2026-07-01T14:35:11+09:00",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.currentStation, TEST_ROUTE.stationList[3]);
  assert.equal(result.body.nextStation, null);
  assert.equal(result.body.remainingStations, 0);
  assert.equal(result.body.tripStatus, TRIP_STATUS.TRIP_DONE);
  assert.equal(result.body.shouldTriggerBell, false);

  assert.equal(saved.length, 1);
  const savedInput = saved[0] as {
    status: { remainingStations: number; tripStatus: string };
    locationLog: { remainingStations: number; locationAccepted: boolean; reason: string | null };
  };
  assert.equal(savedInput.status.remainingStations, 0);
  assert.equal(savedInput.status.tripStatus, TRIP_STATUS.TRIP_DONE);
  assert.equal(savedInput.locationLog.remainingStations, 0);
  assert.equal(savedInput.locationLog.locationAccepted, true);
  assert.equal(savedInput.locationLog.reason, null);
});

test("keeps WAITING_BUS and never creates a bell before boarding confirmation", async () => {
  const saved: unknown[] = [];
  let generatedBellRequest = false;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-waiting-near",
      latitude: TEST_ROUTE.stationList[2]!.latitude,
      longitude: TEST_ROUTE.stationList[2]!.longitude,
      recordedAt: "2026-08-22T01:00:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({ trip: baseTrip, status: baseStatus }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      generateBellRequestId: () => {
        generatedBellRequest = true;
        return "bell-must-not-exist";
      },
      now: () => "2026-08-22T01:00:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.tripStatus, TRIP_STATUS.WAITING_BUS);
  assert.equal(result.body.remainingStations, 1);
  assert.equal(result.body.shouldTriggerBell, false);
  assert.equal(result.body.boardingConfirmedAt, null);
  assert.equal(generatedBellRequest, false);
  assert.equal(saved.length, 1);
  assert.equal("bellRequest" in (saved[0] as Record<string, unknown>), false);
});

test("returns the authoritative ON_BUS state when confirmation wins during a stale GPS save", async () => {
  let findCalls = 0;
  let saved = false;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-stale-after-confirmation",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-08-22T01:00:01.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => {
        findCalls += 1;
        if (!saved) return { trip: baseTrip, status: baseStatus };
        return {
          trip: baseTrip,
          status: {
            ...baseStatus,
            currentStation: TEST_ROUTE.stationList[1]!,
            nextStation: TEST_ROUTE.stationList[2]!,
            remainingStations: 2,
            tripStatus: TRIP_STATUS.ON_BUS,
            boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
            boardingConfirmedAt: "2026-08-22T01:00:00.000Z",
            lastRequestId: "loc-stale-after-confirmation",
          },
        };
      },
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        saved = true;
        return { bellCreated: false };
      },
      now: () => "2026-08-22T01:00:02.000Z",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) throw new Error("expected successful status update");
  assert.equal(findCalls, 2);
  assert.equal(result.body.tripStatus, TRIP_STATUS.ON_BUS);
  assert.equal(result.body.boardingMethod, BOARDING_METHOD.USER_CONFIRMED);
  assert.equal(result.body.boardingConfirmedAt, "2026-08-22T01:00:00.000Z");
});

test("ignores a backward station update and records BACKWARD_STATION_IGNORED", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-backward-1",
      latitude: TEST_ROUTE.stationList[0]!.latitude,
      longitude: TEST_ROUTE.stationList[0]!.longitude,
      recordedAt: "2026-07-01T14:35:20+09:00",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[1]!,
          nextStation: TEST_ROUTE.stationList[2]!,
          remainingStations: 2,
          ...confirmedBoarding,
          tripStatus: TRIP_STATUS.ON_BUS,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      now: () => "2026-07-01T14:35:21+09:00",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.currentStation, TEST_ROUTE.stationList[1]);
  assert.equal(result.body.nextStation, TEST_ROUTE.stationList[2]);
  assert.equal(result.body.remainingStations, 2);
  assert.equal(result.body.tripStatus, TRIP_STATUS.ON_BUS);

  assert.equal(saved.length, 1);
  const savedInput = saved[0] as {
    locationLog: {
      currentStation: (typeof TEST_ROUTE.stationList)[number] | null;
      remainingStations: number;
      locationAccepted: boolean;
      reason: string | null;
    };
  };
  assert.equal(savedInput.locationLog.currentStation, TEST_ROUTE.stationList[1]);
  assert.equal(savedInput.locationLog.remainingStations, 2);
  assert.equal(savedInput.locationLog.locationAccepted, false);
  assert.equal(savedInput.locationLog.reason, "BACKWARD_STATION_IGNORED");
});

test("returns 400 INVALID_REQUEST for an invalid location update without reading the repository", async () => {
  let findCalls = 0;

  const result = await updateTripStatus(
    "trip-test-001",
    { requestId: "", latitude: 37.49, longitude: 127.03 },
    {
      findTripProgressData: async () => {
        findCalls += 1;
        throw new Error("should not be called");
      },
      findLocationLogByRequestId: async () => {
        throw new Error("should not be called");
      },
      saveStatusAndLocation: async () => {
        throw new Error("should not be called");
      },
      now: () => "2026-07-01T14:35:30+09:00",
    },
  );

  assert.equal(result.httpStatus, 400);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "INVALID_REQUEST",
    message: "요청 데이터가 올바르지 않습니다.",
    timestamp: "2026-07-01T14:35:30+09:00",
  });
  assert.equal(findCalls, 0);
});

test("returns 500 DB_ERROR when saving a location update fails", async () => {
  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-save-db-error",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-01T14:35:40+09:00",
      source: "GPS",
    },
    {
      findTripProgressData: async () => ({ trip: baseTrip, status: baseStatus }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        throw new Error("Supabase unavailable");
      },
      now: () => "2026-07-01T14:35:41+09:00",
    },
  );

  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "DB_ERROR",
    message: "이동 상태를 저장하지 못했습니다.",
    timestamp: "2026-07-01T14:35:41+09:00",
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
          ...confirmedBoarding,
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
          ...confirmedBoarding,
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

test("returns STOP_REQUEST when the database confirms this GPS request won the bell transition", async () => {
  let saved = false;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-bell-winner",
      latitude: TEST_ROUTE.stationList[2]!.latitude,
      longitude: TEST_ROUTE.stationList[2]!.longitude,
      recordedAt: "2026-08-22T01:00:30.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => {
        if (!saved) {
          return {
            trip: baseTrip,
            status: {
              ...baseStatus,
              currentStation: TEST_ROUTE.stationList[1]!,
              nextStation: TEST_ROUTE.stationList[2]!,
              remainingStations: 2,
              ...confirmedBoarding,
              tripStatus: TRIP_STATUS.ON_BUS,
            },
          };
        }

        // Supabase status reads intentionally return command:null because GET
        // must never replay an executable command.
        return {
          trip: baseTrip,
          status: {
            ...baseStatus,
            currentStation: TEST_ROUTE.stationList[2]!,
            nextStation: TEST_ROUTE.stationList[3]!,
            remainingStations: 1,
            ...confirmedBoarding,
            tripStatus: TRIP_STATUS.NEAR_DESTINATION,
            bellStatus: BELL_STATUS.PENDING,
            bellRequestId: "bell-db-winner",
            command: null,
            lastRequestId: "loc-bell-winner",
          },
        };
      },
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        saved = true;
        return { bellCreated: true };
      },
      generateBellRequestId: () => "bell-db-winner",
      now: () => "2026-08-22T01:00:31.000Z",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) throw new Error("expected successful status update");
  assert.equal(result.body.shouldTriggerBell, true);
  assert.equal(result.body.bellStatus, BELL_STATUS.PENDING);
  assert.equal(result.body.bellRequestId, "bell-db-winner");
  assert.equal(result.body.command, BELL_COMMAND.STOP_REQUEST);
});

test("returns shouldTriggerBell false when another GPS request wins the bell transition", async () => {
  let saved = false;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-bell-loser",
      latitude: TEST_ROUTE.stationList[2]!.latitude,
      longitude: TEST_ROUTE.stationList[2]!.longitude,
      recordedAt: "2026-08-22T01:01:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => {
        if (!saved) {
          return {
            trip: baseTrip,
            status: {
              ...baseStatus,
              currentStation: TEST_ROUTE.stationList[1]!,
              nextStation: TEST_ROUTE.stationList[2]!,
              remainingStations: 2,
              ...confirmedBoarding,
              tripStatus: TRIP_STATUS.ON_BUS,
            },
          };
        }

        return {
          trip: baseTrip,
          status: {
            ...baseStatus,
            currentStation: TEST_ROUTE.stationList[2]!,
            nextStation: TEST_ROUTE.stationList[3]!,
            remainingStations: 1,
            ...confirmedBoarding,
            tripStatus: TRIP_STATUS.NEAR_DESTINATION,
            bellStatus: BELL_STATUS.PENDING,
            bellRequestId: "bell-winner",
            command: null,
            lastRequestId: "loc-bell-winner",
          },
        };
      },
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        saved = true;
        return { bellCreated: false };
      },
      generateBellRequestId: () => "bell-local-loser",
      now: () => "2026-08-22T01:01:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) throw new Error("expected successful status update");
  assert.equal(result.body.shouldTriggerBell, false);
  assert.equal(result.body.bellStatus, BELL_STATUS.PENDING);
  assert.equal(result.body.bellRequestId, "bell-winner");
  assert.equal(result.body.command, null);
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
          ...confirmedBoarding,
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

test("keeps SUCCESS bell status at one remaining station without generating another request", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-bell-success-1",
      latitude: TEST_ROUTE.stationList[2]!.latitude,
      longitude: TEST_ROUTE.stationList[2]!.longitude,
      recordedAt: "2026-07-01T14:37:10+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[2]!,
          nextStation: TEST_ROUTE.stationList[3]!,
          remainingStations: 1,
          ...confirmedBoarding,
          tripStatus: TRIP_STATUS.NEAR_DESTINATION,
          bellStatus: BELL_STATUS.SUCCESS,
          bellRequestId: "bell-success-1",
          command: BELL_COMMAND.STOP_REQUEST,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      generateBellRequestId: () => {
        throw new Error("should not generate a second bell request");
      },
      now: () => "2026-07-01T14:37:11+09:00",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.remainingStations, 1);
  assert.equal(result.body.bellStatus, BELL_STATUS.SUCCESS);
  assert.equal(result.body.shouldTriggerBell, false);
  assert.equal(result.body.bellRequestId, "bell-success-1");

  assert.equal(saved.length, 1);
  const savedInput = saved[0] as { status: { bellStatus: string }; bellRequest?: unknown };
  assert.equal(savedInput.status.bellStatus, BELL_STATUS.SUCCESS);
  assert.equal(savedInput.bellRequest ?? null, null);
});

test("keeps FAIL bell status at one remaining station without generating another request", async () => {
  const saved: unknown[] = [];

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-bell-fail-1",
      latitude: TEST_ROUTE.stationList[2]!.latitude,
      longitude: TEST_ROUTE.stationList[2]!.longitude,
      recordedAt: "2026-07-01T14:37:20+09:00",
      source: "MOCK",
    },
    {
      findTripProgressData: async () => ({
        trip: baseTrip,
        status: {
          ...baseStatus,
          currentStation: TEST_ROUTE.stationList[2]!,
          nextStation: TEST_ROUTE.stationList[3]!,
          remainingStations: 1,
          ...confirmedBoarding,
          tripStatus: TRIP_STATUS.NEAR_DESTINATION,
          bellStatus: BELL_STATUS.FAIL,
          bellRequestId: "bell-fail-1",
          command: BELL_COMMAND.STOP_REQUEST,
        },
      }),
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async (data) => {
        saved.push(data);
      },
      generateBellRequestId: () => {
        throw new Error("should not generate a second bell request");
      },
      now: () => "2026-07-01T14:37:21+09:00",
    },
  );

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.equal(result.body.remainingStations, 1);
  assert.equal(result.body.bellStatus, BELL_STATUS.FAIL);
  assert.equal(result.body.shouldTriggerBell, false);
  assert.equal(result.body.bellRequestId, "bell-fail-1");

  assert.equal(saved.length, 1);
  const savedInput = saved[0] as { status: { bellStatus: string }; bellRequest?: unknown };
  assert.equal(savedInput.status.bellStatus, BELL_STATUS.FAIL);
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

test("returns cached success when a concurrent request wins the race for the same requestId", async () => {
  let findCalls = 0;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-race-1",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-27T12:20:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => {
        findCalls += 1;
        if (findCalls === 1) {
          return { trip: baseTrip, status: baseStatus };
        }
        // 재조회 시점에는 경쟁에서 이긴 다른 요청이 이미 저장한 최신 상태가 보인다.
        return {
          trip: baseTrip,
          status: {
            ...baseStatus,
            currentStation: TEST_ROUTE.stationList[1]!,
            nextStation: TEST_ROUTE.stationList[2]!,
            remainingStations: 2,
            ...confirmedBoarding,
            tripStatus: TRIP_STATUS.ON_BUS,
            lastRequestId: "loc-race-1",
          },
        };
      },
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        throw new DuplicateLocationRequestError();
      },
      now: () => "2026-07-27T12:20:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.message, "이미 처리된 위치 업데이트입니다.");
  assert.equal(findCalls, 2);
  if (result.httpStatus !== 200) throw new Error("expected successful status update");
  assert.equal(result.body.remainingStations, 2);
  assert.equal(result.body.tripStatus, TRIP_STATUS.ON_BUS);
});

test("falls back to the pre-race snapshot when the post-race refetch also fails", async () => {
  let findCalls = 0;

  const result = await updateTripStatus(
    "trip-test-001",
    {
      requestId: "loc-race-2",
      latitude: TEST_ROUTE.stationList[1]!.latitude,
      longitude: TEST_ROUTE.stationList[1]!.longitude,
      recordedAt: "2026-07-27T12:21:00.000Z",
      source: "GPS",
    },
    {
      findTripProgressData: async () => {
        findCalls += 1;
        if (findCalls === 1) {
          return { trip: baseTrip, status: baseStatus };
        }
        throw new Error("Supabase network error");
      },
      findLocationLogByRequestId: async () => null,
      saveStatusAndLocation: async () => {
        throw new DuplicateLocationRequestError();
      },
      now: () => "2026-07-27T12:21:01.000Z",
    },
  );

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.message, "이미 처리된 위치 업데이트입니다.");
  assert.equal(findCalls, 2);
  if (result.httpStatus !== 200) throw new Error("expected successful status update");
  assert.equal(result.body.remainingStations, baseStatus.remainingStations);
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
