import assert from "node:assert/strict";

import test from "node:test";

import { BOARDING_METHOD, TRIP_STATUS } from "@bus-ta/shared";

import { checkAndDispatchStatusChange } from "../../../mobile/src/realtime/event-dispatcher.js";

import type {
  AppAction,
  AppTripState,
  RealtimeGuideContext,
  TripStatusChangedEvent,
  TripStatusSnapshot,
} from "../../../mobile/src/realtime/types.js";

const waitingSnapshot: TripStatusSnapshot = {
  tripStatus: TRIP_STATUS.WAITING_BUS,
  boardingMethod: null,
  boardingConfirmedAt: null,
  remainingStations: 1,
  currentStation: { stationName: "수지고등학교" },
  bellStatus: "NOT_REQUESTED",
  guideMessage: "버스 탑승을 기다리고 있습니다.",
};

function createContext(
  lastInjectedStatus: TripStatusSnapshot | null,
  actions: AppAction[],
): RealtimeGuideContext {
  const state = {
    destination: "수지구청역",
    routeCandidates: null,
    routeCandidatesExpiresAt: null,
    announcedCandidateIds: [],
    selectedRoute: null,
    tripId: "trip-test-001",
    tripStatus: waitingSnapshot.tripStatus,
    boardingMethod: waitingSnapshot.boardingMethod,
    boardingConfirmedAt: waitingSnapshot.boardingConfirmedAt,
    currentStation: waitingSnapshot.currentStation,
    nextStation: null,
    remainingStations: waitingSnapshot.remainingStations,
    guideMessage: waitingSnapshot.guideMessage,
    bellStatus: waitingSnapshot.bellStatus,
    bellRequestId: null,
    command: null,
    lastFunctionResult: null,
    lastInjectedStatus,
  } satisfies AppTripState;

  return {
    getAppState: () => state,
    getCurrentLocation: () => undefined,
    refreshCurrentLocation: async () => {},
    dispatchAppAction: (action) => actions.push(action),
  };
}

test("a pre-confirmation GPS event stays WAITING_BUS even with one station remaining", () => {
  const actions: AppAction[] = [];
  const events: TripStatusChangedEvent[] = [];

  checkAndDispatchStatusChange(
    createContext(null, actions),
    waitingSnapshot,
    (event) => events.push(event),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.tripStatus, TRIP_STATUS.WAITING_BUS);
  assert.equal(events[0]?.boardingMethod, null);
  assert.equal(events[0]?.boardingConfirmedAt, null);

  // 세션에 실제로 기억되는 것은 도착정보까지 확정한 스냅샷이다. GET 응답이 아직
  // 도착정보를 준 적이 없으면 두 값은 null 로 확정된다 — 다음 PATCH 응답이 이 값을
  // 이어받아 임박 판정 기준이 끊기지 않게 하기 위함이다.
  assert.deepEqual(actions, [
    {
      type: "SET_LAST_INJECTED_STATUS",
      status: { ...waitingSnapshot, arrivalStatus: null, arrivals: null },
    },
  ]);
});

test("a server-confirmed boarding event includes its authoritative evidence", () => {
  const actions: AppAction[] = [];
  const events: TripStatusChangedEvent[] = [];

  const confirmedSnapshot: TripStatusSnapshot = {
    ...waitingSnapshot,
    tripStatus: TRIP_STATUS.ON_BUS,
    boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
    boardingConfirmedAt: "2026-08-24T01:00:00.000Z",
    remainingStations: 4,
    guideMessage: "버스 탑승을 확인했습니다.",
  };

  checkAndDispatchStatusChange(
    createContext(waitingSnapshot, actions),
    confirmedSnapshot,
    (event) => events.push(event),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.tripStatus, TRIP_STATUS.ON_BUS);
  assert.equal(
    events[0]?.boardingMethod,
    BOARDING_METHOD.USER_CONFIRMED,
  );
  assert.equal(
    events[0]?.boardingConfirmedAt,
    "2026-08-24T01:00:00.000Z",
  );
});