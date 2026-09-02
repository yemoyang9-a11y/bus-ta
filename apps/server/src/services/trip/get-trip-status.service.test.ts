import assert from "node:assert/strict";
import test from "node:test";
import {
  ArrivalInfo,
  BELL_COMMAND,
  BELL_STATUS,
  BOARDING_METHOD,
  DEMO_ROUTE,
  TripStatusResponseSchema,
  TRIP_STATUS,
} from "@bus-ta/shared";
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
  boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
  boardingConfirmedAt: "2026-07-01T14:34:00+09:00",
  bellStatus: BELL_STATUS.NOT_REQUESTED,
  bellRequestId: null,
  command: null,
  lastRequestId: "loc-010",
  locationSource: "MOCK",
  recordedAt: "2026-07-01T14:35:00+09:00",
  lastLatitude: 37.49,
  lastLongitude: 127.03,
  locationChangedAt: "2026-07-01T14:35:00+09:00",
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

test("refreshes arrival information and reports available vehicles", async () => {
  const arrivals: ArrivalInfo[] = [
    {
      predictedArrivalMinutes: 4,
      occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
    },
  ];

  const result = await getTripStatus("trip-test-001", {
    findTripProgressData: async () => ({
      trip: {
        ...baseTrip,
        gbisStationId: "201000166",
        localBusId: "234000021",
      },
      status: waitingBusProgress().status, // 도착정보는 대기 중에만 조회한다
    }),
    getArrivals: async (target) => {
      assert.equal(target.gbisStationId, "201000166");
      assert.equal(target.localBusId, "234000021");
      return { arrivals, arrivalStatus: "AVAILABLE" };
    },
    now: () => "2026-07-01T14:36:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(result.body.arrivals, arrivals);
  assert.equal(result.body.arrivalStatus, "AVAILABLE");
  assert.doesNotThrow(() => TripStatusResponseSchema.parse(result.body));
});

test("reports no vehicle separately from an upstream arrival lookup failure", async () => {
  const noVehicle = await getTripStatus("trip-test-001", {
    findTripProgressData: async () => ({
      trip: { ...baseTrip, gbisStationId: "201000166", localBusId: "234000021" },
      status: waitingBusProgress().status, // 도착정보는 대기 중에만 조회한다
    }),
    getArrivals: async () => ({ arrivals: [], arrivalStatus: "NO_VEHICLE" }),
    now: () => "2026-07-01T14:36:00+09:00",
  });
  const upstreamFailure = await getTripStatus("trip-test-001", {
    findTripProgressData: async () => ({
      trip: { ...baseTrip, gbisStationId: "201000166", localBusId: "234000021" },
      status: waitingBusProgress().status, // 도착정보는 대기 중에만 조회한다
    }),
    getArrivals: async () => {
      throw new Error("GBIS unavailable");
    },
    now: () => "2026-07-01T14:36:00+09:00",
  });

  assert.equal(noVehicle.httpStatus, 200);
  assert.equal(upstreamFailure.httpStatus, 200);
  if (noVehicle.httpStatus !== 200 || upstreamFailure.httpStatus !== 200) return;
  assert.deepEqual(noVehicle.body.arrivals, []);
  assert.equal(noVehicle.body.arrivalStatus, "NO_VEHICLE");
  assert.deepEqual(upstreamFailure.body.arrivals, []);
  assert.equal(upstreamFailure.body.arrivalStatus, "UPSTREAM_ERROR");
});

// 방향 검증 실패는 fail-closed 로 arrivals 를 비우지만 "차가 없다"는 뜻이 아니다.
// 두 경우를 합쳐 NO_VEHICLE 로 안내하면 버스를 놓친 사용자가 "이 노선은 이제 안 온다"로
// 잘못 판단한다.
test("방향을 확인하지 못한 조회는 NO_VEHICLE 이 아니라 UPSTREAM_ERROR 로 보고한다", async () => {
  const result = await getTripStatus("trip-test-001", {
    findTripProgressData: async () => ({
      trip: { ...baseTrip, gbisStationId: "201000166", localBusId: "234000021" },
      status: waitingBusProgress().status, // 도착정보는 대기 중에만 조회한다
    }),
    getArrivals: async () => ({ arrivals: [], arrivalStatus: "UPSTREAM_ERROR" }),
    now: () => "2026-07-01T14:36:00+09:00",
  });

  assert.equal(result.httpStatus, 200);
  if (result.httpStatus !== 200) return;
  assert.deepEqual(result.body.arrivals, []);
  assert.equal(result.body.arrivalStatus, "UPSTREAM_ERROR");
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


function waitingBusProgress(): TripProgressData {
  return {
    trip: { ...baseTrip, gbisStationId: "201000166", localBusId: "234000021" },
    status: {
      ...baseStatus,
      tripStatus: TRIP_STATUS.WAITING_BUS,
      boardingMethod: null,
      boardingConfirmedAt: null,
    },
  };
}

function arrivalAfter(minutes: number): ArrivalInfo {
  return {
    predictedArrivalMinutes: minutes,
    occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
  };
}

// ─────────────────────────────────────────────
// 대기 중 도착정보 반복 조회와 비콘 스캔 신호.
// 지금까지 앱은 GET /status 를 사용자가 물을 때만 불렀고, 서버는 "언제 다시 물어봐"도
// "비콘 켜라"도 알려주지 않았다. 그래서 기다리는 동안 도착 예정 시간이 갱신되지 않고
// 음성 경로에서는 비콘이 아예 켜지지 않았다.
// ─────────────────────────────────────────────

test("대기 중이고 도착이 임박하면 비콘 스캔 신호를 켠다", async () => {
  const result = await getTripStatus("trip-1", {
    findTripProgressData: async () => waitingBusProgress(),
    getArrivals: async () => ({
      arrivals: [arrivalAfter(3)],
      arrivalStatus: "AVAILABLE" as const,
      nextRefreshInMs: 90_000,
    }),
    now: () => "2026-09-01T00:00:00.000Z",
  });

  assert.equal(result.httpStatus, 200);
  const body = result.body as Record<string, unknown>;
  assert.equal(body.shouldScanBeacon, true);
  assert.equal(body.nextArrivalRefreshInMs, 90_000);
});

test("대기 중이어도 버스가 멀면 비콘 스캔 신호를 켜지 않는다", async () => {
  const result = await getTripStatus("trip-1", {
    findTripProgressData: async () => waitingBusProgress(),
    getArrivals: async () => ({
      arrivals: [arrivalAfter(30)],
      arrivalStatus: "AVAILABLE" as const,
    }),
    now: () => "2026-09-01T00:00:00.000Z",
  });

  const body = result.body as Record<string, unknown>;
  assert.equal(body.shouldScanBeacon, false);
  assert.equal(
    body.nextArrivalRefreshInMs,
    undefined,
    "주기를 모르면 필드를 생략한다 — 앱이 임의 주기를 만들지 않게 한다",
  );
});

test("도착정보를 확인하지 못하면 비콘 스캔을 켜 둔다", async () => {
  // 값이 없다고 스캔을 막으면 비콘 감지가 영영 시작되지 않는다.
  // 배터리보다 탑승을 놓치지 않는 쪽을 우선한다.
  const result = await getTripStatus("trip-1", {
    findTripProgressData: async () => waitingBusProgress(),
    getArrivals: async () => ({ arrivals: [], arrivalStatus: "UPSTREAM_ERROR" as const }),
    now: () => "2026-09-01T00:00:00.000Z",
  });

  const body = result.body as Record<string, unknown>;
  assert.equal(body.shouldScanBeacon, true);
});

test("NO_VEHICLE 이면 비콘 스캔을 켜지 않는다", async () => {
  // 조회에 성공했고 오는 차가 없다는 확인된 사실이다. 이때까지 켜 두면 올 차도
  // 없는데 배터리만 쓴다. 확인하지 못한 경우(UPSTREAM_ERROR)와 구분해야 한다.
  const result = await getTripStatus("trip-1", {
    findTripProgressData: async () => waitingBusProgress(),
    getArrivals: async () => ({ arrivals: [], arrivalStatus: "NO_VEHICLE" as const }),
    now: () => "2026-09-01T00:00:00.000Z",
  });

  const body = result.body as Record<string, unknown>;
  assert.equal(body.shouldScanBeacon, false);
});

test("탑승이 확정된 뒤에는 도착정보를 아예 조회하지 않는다", async () => {
  // 탑승 뒤에는 이 값을 쓸 곳이 없다. 그런데도 부르면 운행 내내 GBIS 호출이 이어진다.
  let calls = 0;
  const result = await getTripStatus("trip-1", {
    findTripProgressData: async () => ({
      trip: { ...baseTrip, gbisStationId: "201000166", localBusId: "234000021" },
      status: baseStatus, // ON_BUS
    }),
    getArrivals: async () => {
      calls += 1;
      return {
        arrivals: [arrivalAfter(2)],
        arrivalStatus: "AVAILABLE" as const,
        nextRefreshInMs: 60_000,
      };
    },
    now: () => "2026-09-01T00:00:00.000Z",
  });

  assert.equal(calls, 0, "WAITING_BUS 가 아니면 GBIS 를 부르지 않는다");
  // 도착정보 관련 네 필드는 대기 중에만 싣는다.
  const body = result.body as Record<string, unknown>;
  for (const field of ["arrivals", "arrivalStatus", "nextArrivalRefreshInMs", "shouldScanBeacon"]) {
    assert.equal(field in body, false, `${field} 는 쓸 곳이 없으므로 싣지 않는다`);
  }
});

test("대기 중 조회에는 목적지 정류장이 함께 전달된다", async () => {
  // 회차 노선은 목적지로 방향을 가른다. 여기서 빠지면 캐시 키도 갈라지고
  // 반대 방향 도착정보를 안내할 수 있다.
  let seenDestination: unknown;
  await getTripStatus("trip-1", {
    findTripProgressData: async () => waitingBusProgress(),
    getArrivals: async (target) => {
      seenDestination = target.destinationStation;
      return { arrivals: [arrivalAfter(4)], arrivalStatus: "AVAILABLE" as const };
    },
    now: () => "2026-09-01T00:00:00.000Z",
  });

  assert.ok(seenDestination, "destinationStation 이 전달되어야 한다");
});

test("놓침 발화일 때만 강제 재조회 플래그를 전달한다", async () => {
  const seen: Array<boolean | undefined> = [];
  const deps = {
    findTripProgressData: async () => waitingBusProgress(),
    getArrivals: async (target: { refresh?: boolean }) => {
      seen.push(target.refresh);
      return { arrivals: [arrivalAfter(4)], arrivalStatus: "AVAILABLE" as const };
    },
    now: () => "2026-09-01T00:00:00.000Z",
  };

  await getTripStatus("trip-1", deps);
  await getTripStatus("trip-1", { ...deps, refreshArrivals: true });

  assert.deepEqual(
    seen,
    [undefined, true],
    "일반 조회에는 붙지 않고 놓침 발화에만 붙어야 한다",
  );
});

test("성공 응답이 공유 스키마(TripStatusResponseSchema)를 통과한다", async () => {
  // 서버가 필드를 추가했는데 packages/shared 를 안 고치면, 타입 계약과 실제 응답이
  // 어긋난 채로 앱이 그 값을 읽게 된다(예모 리뷰, PR #45).
  const result = await getTripStatus("trip-1", {
    findTripProgressData: async () => waitingBusProgress(),
    getArrivals: async () => ({
      arrivals: [arrivalAfter(3)],
      arrivalStatus: "AVAILABLE" as const,
      nextRefreshInMs: 60_000,
    }),
    now: () => "2026-09-01T00:00:00.000+09:00",
  });

  const parsed = TripStatusResponseSchema.safeParse(result.body);
  assert.equal(
    parsed.success,
    true,
    parsed.success ? "" : JSON.stringify(parsed.error.issues),
  );
  if (!parsed.success) return;
  assert.equal(parsed.data.nextArrivalRefreshInMs, 60_000);
  assert.equal(parsed.data.shouldScanBeacon, true);
});

test("탑승 뒤 응답도 공유 스키마를 통과한다 — 네 필드는 선택이다", async () => {
  const result = await getTripStatus("trip-1", {
    findTripProgressData: async () => ({
      trip: { ...baseTrip, gbisStationId: "201000166", localBusId: "234000021" },
      status: baseStatus, // ON_BUS
    }),
    getArrivals: async () => ({ arrivals: [], arrivalStatus: "NO_VEHICLE" as const }),
    now: () => "2026-09-01T00:00:00.000+09:00",
  });

  const parsed = TripStatusResponseSchema.safeParse(result.body);
  assert.equal(
    parsed.success,
    true,
    parsed.success ? "" : JSON.stringify(parsed.error.issues),
  );

  // safeParse 성공만 보면 네 필드가 실수로 실려도 통과한다. Zod 는 optional 을
  // "있어도 되고 없어도 된다"로 보기 때문이다. 실제로 빠졌는지 따로 확인한다.
  for (const field of [
    "arrivals",
    "arrivalStatus",
    "nextArrivalRefreshInMs",
    "shouldScanBeacon",
  ]) {
    assert.equal(field in result.body, false, `${field} 는 대기 중에만 실려야 한다`);
  }
});
