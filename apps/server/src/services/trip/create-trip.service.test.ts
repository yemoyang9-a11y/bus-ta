import assert from "node:assert/strict";
import test from "node:test";
import {
  BELL_STATUS,
  CreateTripResponseSchema,
  DEMO_ROUTE,
  TRIP_STATUS,
  type ArrivalInfo,
} from "@bus-ta/shared";
import { createTrip } from "./create-trip.service.js";

// 계약 5.2-A 예시. 첫 차량은 혼잡도만, 두 번째 차량은 잔여좌석만 제공한다.
const twoArrivals: ArrivalInfo[] = [
  {
    predictedArrivalMinutes: 6,
    occupancy: { type: "CONGESTION", congestionLevel: 3, remainingSeats: null },
  },
  {
    predictedArrivalMinutes: 21,
    occupancy: { type: "REMAINING_SEATS", congestionLevel: null, remainingSeats: 4 },
  },
];

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
      getArrivals: async () => twoArrivals,
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
    arrivals: twoArrivals,
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
      totalTime: DEMO_ROUTE.totalTime ?? null,
      totalWalk: DEMO_ROUTE.totalWalk ?? null,
      payment: DEMO_ROUTE.payment ?? null,
      busTransitCount: DEMO_ROUTE.busTransitCount ?? null,
      busStationCount: DEMO_ROUTE.busStationCount ?? null,
      totalDistance: DEMO_ROUTE.totalDistance ?? null,
      intervalTime: DEMO_ROUTE.intervalTime ?? null,
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
      lastLatitude: null,
      lastLongitude: null,
      locationChangedAt: null,
      updatedAt: "2026-07-01T14:31:00+09:00",
    },
  });
});

test("continues trip creation with an empty arrivals list when the GBIS lookup fails", async () => {
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
      getArrivals: async () => {
        throw new Error("GBIS unavailable");
      },
      generateTripId: () => "trip-test-002",
      now: () => "2026-07-01T14:31:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 201);
  assert.deepEqual(result.body.arrivals, []);
  assert.equal(
    (saved[0] as { trip: { predictedArrivalMinutes: number | null } }).trip.predictedArrivalMinutes,
    null,
  );
});

test("GBIS 도착정보가 없으면 arrivals 는 빈 배열이고 저장되는 도착 시간도 null 이다", async () => {
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
      getArrivals: async () => [],
      generateTripId: () => "trip-test-no-arrival",
      now: () => "2026-07-01T14:31:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 201);
  assert.deepEqual(result.body.arrivals, []);
  assert.equal(
    (saved[0] as { trip: { predictedArrivalMinutes: number | null } }).trip.predictedArrivalMinutes,
    null,
  );
});

test("DB 에는 첫 번째 차량의 도착 시간만 저장하고 occupancy 는 저장하지 않는다", async () => {
  const saved: unknown[] = [];

  await createTrip(
    {
      ...DEMO_ROUTE,
      destination: "도착정류장",
    },
    {
      createTripWithStatus: async (data) => {
        saved.push(data);
      },
      getArrivals: async () => twoArrivals,
      generateTripId: () => "trip-test-first-arrival",
      now: () => "2026-07-01T14:31:00+09:00",
    },
  );

  const trip = (saved[0] as { trip: Record<string, unknown> }).trip;
  assert.equal(trip.predictedArrivalMinutes, 6);
  assert.equal("arrivals" in trip, false, "arrivals 는 응답 전용이며 저장하지 않는다");
  assert.equal("occupancy" in trip, false, "occupancy 는 응답 전용이며 저장하지 않는다");
});

test("도착 예정 차량이 세 대 이상이어도 arrivals 는 최대 두 개다", async () => {
  const result = await createTrip(
    {
      ...DEMO_ROUTE,
      destination: "도착정류장",
    },
    {
      createTripWithStatus: async () => {},
      getArrivals: async () => [
        ...twoArrivals,
        {
          predictedArrivalMinutes: 33,
          occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
        },
      ],
      generateTripId: () => "trip-test-max-two",
      now: () => "2026-07-01T14:31:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 201);
  assert.deepEqual(result.body.arrivals, twoArrivals);
});

test("계약에 맞지 않는 도착 정보 항목은 응답에서 제외한다", async () => {
  const result = await createTrip(
    {
      ...DEMO_ROUTE,
      destination: "도착정류장",
    },
    {
      createTripWithStatus: async () => {},
      getArrivals: async () =>
        [
          // 도착 시간이 음수
          { predictedArrivalMinutes: -1, occupancy: twoArrivals[0]!.occupancy },
          // type 과 값이 어긋난 occupancy: CONGESTION 인데 좌석 수가 들어 있다
          {
            predictedArrivalMinutes: 9,
            occupancy: { type: "CONGESTION", congestionLevel: null, remainingSeats: 0 },
          },
          twoArrivals[1]!,
        ] as ArrivalInfo[],
      generateTripId: () => "trip-test-invalid-arrival",
      now: () => "2026-07-01T14:31:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 201);
  assert.deepEqual(result.body.arrivals, [twoArrivals[1]]);
});

test("201 응답은 공개 계약(CreateTripResponseSchema)을 통과한다", async () => {
  for (const arrivals of [twoArrivals, [twoArrivals[0]!], [] as ArrivalInfo[]]) {
    const result = await createTrip(
      {
        ...DEMO_ROUTE,
        destination: "도착정류장",
      },
      {
        createTripWithStatus: async () => {},
        getArrivals: async () => arrivals,
        generateTripId: () => "trip-test-contract",
        now: () => "2026-07-01T14:31:00+09:00",
      },
    );

    assert.equal(result.httpStatus, 201);

    const parsed = CreateTripResponseSchema.safeParse(result.body);
    assert.equal(
      parsed.success,
      true,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    );
  }
});

test("returns 400 INVALID_REQUEST for an invalid create-trip payload without saving", async () => {
  let createCalls = 0;

  const result = await createTrip(
    { destination: "도착정류장" },
    {
      createTripWithStatus: async () => {
        createCalls += 1;
      },
      getArrivals: async () => twoArrivals,
      generateTripId: () => "trip-invalid-request",
      now: () => "2026-07-01T14:32:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 400);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "INVALID_REQUEST",
    message: "요청 데이터가 올바르지 않습니다.",
    timestamp: "2026-07-01T14:32:00+09:00",
  });
  assert.equal(createCalls, 0);
});

test("returns 500 DB_ERROR when saving the trip fails", async () => {
  const result = await createTrip(
    {
      ...DEMO_ROUTE,
      destination: "도착정류장",
    },
    {
      createTripWithStatus: async () => {
        throw new Error("Supabase unavailable");
      },
      getArrivals: async () => twoArrivals,
      generateTripId: () => "trip-db-error",
      now: () => "2026-07-01T14:33:00+09:00",
    },
  );

  assert.equal(result.httpStatus, 500);
  assert.deepEqual(result.body, {
    success: false,
    errorCode: "DB_ERROR",
    message: "운행 정보를 저장하지 못했습니다.",
    timestamp: "2026-07-01T14:33:00+09:00",
  });
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
      getArrivals: async () => twoArrivals,
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
