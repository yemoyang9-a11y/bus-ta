import assert from "node:assert/strict";
import test from "node:test";
import { TRIP_STATUS } from "@bus-ta/shared";
import { checkAndDispatchStatusChange } from "../../../mobile/src/realtime/event-dispatcher.js";
import { toTripStatusSnapshot } from "../../../mobile/src/realtime/status-snapshot.js";
import type {
  AppAction,
  AppTripState,
  RealtimeGuideContext,
  TripStatusChangedEvent,
  TripStatusSnapshot,
} from "../../../mobile/src/realtime/types.js";

const arrivalAfter = (minutes: number) => ({
  predictedArrivalMinutes: minutes,
  occupancy: { type: "UNAVAILABLE" as const, congestionLevel: null, remainingSeats: null },
});

const baseSnapshot: TripStatusSnapshot = {
  tripStatus: TRIP_STATUS.WAITING_BUS,
  boardingMethod: null,
  boardingConfirmedAt: null,
  remainingStations: 5,
  currentStation: null,
  bellStatus: "NOT_REQUESTED",
  guideMessage: "버스 탑승을 기다리고 있습니다.",
};

const waitingSnapshotWith = (minutes: number[]): TripStatusSnapshot => ({
  ...baseSnapshot,
  arrivalStatus: "AVAILABLE",
  arrivals: minutes.map(arrivalAfter),
  nextArrivalRefreshInMs: 30_000,
});

/**
 * lastInjectedStatus 를 실제로 이어 주는 Dispatcher 경계.
 * 한 세션이 여러 번 상태를 주입하는 흐름을 그대로 재현한다.
 */
function createBoundary() {
  const events: TripStatusChangedEvent[] = [];
  const state = {
    destination: "수원대학교",
    routeCandidates: null,
    routeCandidatesExpiresAt: null,
    announcedCandidateIds: [],
    selectedRoute: null,
    tripId: "trip-test-001",
    tripStatus: TRIP_STATUS.WAITING_BUS,
    boardingMethod: null,
    boardingConfirmedAt: null,
    currentStation: null,
    nextStation: null,
    remainingStations: 5,
    guideMessage: null,
    bellStatus: "NOT_REQUESTED",
    bellRequestId: null,
    command: null,
    lastFunctionResult: null,
    lastInjectedStatus: null as TripStatusSnapshot | null,
  } satisfies AppTripState;

  const context: RealtimeGuideContext = {
    getAppState: () => state,
    getCurrentLocation: () => undefined,
    refreshCurrentLocation: async () => {},
    dispatchAppAction: (action: AppAction) => {
      if (action.type === "SET_LAST_INJECTED_STATUS") {
        state.lastInjectedStatus = action.status;
      }
    },
  };

  return {
    events,
    inject(next: TripStatusSnapshot) {
      checkAndDispatchStatusChange(context, next, (event) => events.push(event));
    },
  };
}

test("주기 GET 이 갱신한 최신 도착시간이 Realtime 이벤트에 실린다", () => {
  // 안내가 나가는 순간 AI 가 보는 값은 create_trip 의 5분이 아니라 방금 받은 3분이어야 한다.
  const boundary = createBoundary();
  boundary.inject(waitingSnapshotWith([5, 14]));
  boundary.inject({
    ...waitingSnapshotWith([3, 12]),
    currentStation: { stationName: "수지고등학교" },
  });

  assert.equal(boundary.events.length, 2);
  assert.equal(boundary.events[1]?.arrivalStatus, "AVAILABLE");
  assert.deepEqual(boundary.events[1]?.predictedArrivalMinutes, [3, 12]);
});

test("도착시간이 5분에서 3분으로 바뀐 것만으로는 음성 안내를 만들지 않는다", () => {
  // 갱신 주기마다 말하면 기다리는 내내 계속 떠든다. 임박 경계에서만 말한다.
  const boundary = createBoundary();
  boundary.inject(waitingSnapshotWith([5, 14]));
  boundary.inject(waitingSnapshotWith([3, 12]));

  assert.equal(boundary.events.length, 1);
});

test("첫 차량이 2분 이내로 처음 진입할 때만 임박 안내를 만든다", () => {
  const boundary = createBoundary();
  boundary.inject(waitingSnapshotWith([5, 14]));
  boundary.inject(waitingSnapshotWith([3, 12]));
  assert.equal(boundary.events.length, 1, "5→3 은 임박 안내가 아니다");

  boundary.inject(waitingSnapshotWith([2, 11]));
  assert.equal(boundary.events.length, 2, "3→2 는 임박 진입이므로 안내한다");
  assert.deepEqual(boundary.events[1]?.predictedArrivalMinutes, [2, 11]);

  boundary.inject(waitingSnapshotWith([1, 10]));
  assert.equal(boundary.events.length, 2, "2→1 은 같은 임박 구간이라 다시 안내하지 않는다");
});

test("도착정보가 없는 PATCH 상태가 끼어들어도 임박 안내가 두 번 나가지 않는다", () => {
  // 3초 주기 PATCH 응답에는 도착정보가 없다. 그때 직전 값을 잊어버리면 다음 GET 의
  // 1분이 "처음 2분 이내 진입"으로 보여 같은 안내가 다시 나간다.
  const boundary = createBoundary();
  boundary.inject(waitingSnapshotWith([3, 12]));
  boundary.inject(waitingSnapshotWith([2, 11]));
  assert.equal(boundary.events.length, 2);

  boundary.inject({ ...baseSnapshot, currentStation: { stationName: "수지고등학교" } });
  assert.equal(boundary.events.length, 3, "정류장이 바뀌었으므로 상태 안내 자체는 나간다");
  assert.deepEqual(
    boundary.events[2]?.predictedArrivalMinutes,
    [2, 11],
    "도착정보가 없는 응답은 직전 값을 지우지 않는다",
  );

  // 정류장은 그대로 두고 도착시간만 줄인다 — 임박 판정만 따로 보기 위해서다.
  boundary.inject({
    ...waitingSnapshotWith([1, 10]),
    currentStation: { stationName: "수지고등학교" },
  });
  assert.equal(boundary.events.length, 3, "1분은 이미 임박 구간 안이라 다시 안내하지 않는다");
});

test("조회에 실패한 상태는 이전 도착시간을 최신값처럼 싣지 않는다", () => {
  const boundary = createBoundary();
  boundary.inject(waitingSnapshotWith([5, 14]));
  boundary.inject({
    ...baseSnapshot,
    arrivalStatus: "UPSTREAM_ERROR",
    arrivals: [],
    currentStation: { stationName: "수지고등학교" },
  });

  assert.equal(boundary.events[1]?.arrivalStatus, "UPSTREAM_ERROR");
  assert.deepEqual(boundary.events[1]?.predictedArrivalMinutes, []);
});

test("상태 주입을 진단할 수 있게 안전한 필드만 로그로 남긴다", (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });

  const boundary = createBoundary();
  boundary.inject(waitingSnapshotWith([2, 11]));

  const injection = logs.find((line) => line.startsWith("[realtime/arrival] status injection"));
  assert.ok(injection, `주입 로그가 없다: ${JSON.stringify(logs)}`);
  assert.match(injection, /tripId=trip-test-001/);
  assert.match(injection, /arrivalStatus=AVAILABLE/);
  assert.match(injection, /predictedArrivalMinutes=\[2,11\]/);
  assert.doesNotMatch(injection, /serviceKey|latitude|longitude|https?:/i);
});

test("GET 응답의 도착정보는 Realtime 스냅샷까지 그대로 전달된다", () => {
  const snapshot = toTripStatusSnapshot({
    tripStatus: TRIP_STATUS.WAITING_BUS,
    boardingMethod: null,
    boardingConfirmedAt: null,
    remainingStations: 5,
    currentStation: null,
    bellStatus: "NOT_REQUESTED",
    guideMessage: "버스 탑승을 기다리고 있습니다.",
    arrivals: [arrivalAfter(3)],
    arrivalStatus: "AVAILABLE",
    nextArrivalRefreshInMs: 30_000,
  });

  assert.equal(snapshot.arrivalStatus, "AVAILABLE");
  assert.deepEqual(snapshot.arrivals, [arrivalAfter(3)]);
  assert.equal(snapshot.nextArrivalRefreshInMs, 30_000);
  assert.equal(snapshot.remainingStations, 5);
});

test("도착정보가 없는 PATCH 응답 스냅샷은 도착정보 필드를 만들지 않는다", () => {
  const snapshot = toTripStatusSnapshot({
    tripStatus: TRIP_STATUS.WAITING_BUS,
    boardingMethod: null,
    boardingConfirmedAt: null,
    remainingStations: 5,
    currentStation: null,
    bellStatus: "NOT_REQUESTED",
    guideMessage: "버스 탑승을 기다리고 있습니다.",
  });

  assert.equal("arrivals" in snapshot, false);
  assert.equal("arrivalStatus" in snapshot, false);
});
