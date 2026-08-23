import assert from "node:assert/strict";
import test from "node:test";
import { BOARDING_METHOD, TRIP_STATUS } from "@bus-ta/shared";
import {
  dispatchRealtimeFunctionCall,
  isRealtimeFunctionCallEvent,
} from "../../../mobile/src/realtime/function-dispatcher.js";
import type {
  AppAction,
  AppTripState,
  RealtimeGuideContext,
} from "../../../mobile/src/realtime/types.js";

const baseState: AppTripState = {
  destination: "수원대학교",
  routeCandidates: null,
  selectedRoute: null,
  tripId: "trip-test-001",
  tripStatus: TRIP_STATUS.WAITING_BUS,
  boardingMethod: null,
  boardingConfirmedAt: null,
  currentStation: null,
  nextStation: null,
  remainingStations: 3,
  guideMessage: "버스 탑승을 기다리고 있습니다.",
  bellStatus: "NOT_REQUESTED",
  bellRequestId: null,
  command: null,
  lastFunctionResult: null,
  lastInjectedStatus: null,
};

function createContext(actions: AppAction[]): RealtimeGuideContext {
  return {
    getAppState: () => baseState,
    getCurrentLocation: () => undefined,
    dispatchAppAction: (action) => actions.push(action),
  };
}

test("accepts confirm_boarding as a Realtime function event", () => {
  assert.equal(
    isRealtimeFunctionCallEvent({
      type: "response.function_call_arguments.done",
      call_id: "call-boarding-1",
      name: "confirm_boarding",
      arguments: "{}",
    }),
    true,
  );
});

test("explicit voice function supplies active trip and USER_CONFIRMED evidence to the API", async () => {
  const actions: AppAction[] = [];
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json({
      success: true,
      tripId: "trip-test-001",
      tripStatus: TRIP_STATUS.ON_BUS,
      boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
      boardingConfirmedAt: "2026-08-22T01:00:00.000Z",
      message: "버스 탑승을 확인했습니다.",
      timestamp: "2026-08-22T01:00:00.000Z",
    });
  };

  try {
    const events = await dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-boarding-1",
        name: "confirm_boarding",
        arguments: "{}",
      },
      createContext(actions),
    );

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.url,
      "http://localhost:3000/api/trips/trip-test-001/boarding/confirm",
    );
    assert.equal(requests[0]?.body.boardingMethod, BOARDING_METHOD.USER_CONFIRMED);
    assert.match(String(requests[0]?.body.requestId), /^boarding-trip-test-001-/);
    assert.deepEqual(actions, [
      {
        type: "CONFIRM_BOARDING",
        tripStatus: TRIP_STATUS.ON_BUS,
        boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
        boardingConfirmedAt: "2026-08-22T01:00:00.000Z",
      },
    ]);
    assert.equal(events[0]?.type, "conversation.item.create");
    if (events[0]?.type === "conversation.item.create") {
      assert.equal(events[0].item.call_id, "call-boarding-1");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent confirm calls share one API request but preserve each Realtime call_id", async () => {
  const actions: AppAction[] = [];
  let fetchCalls = 0;
  let releaseFetch: (() => void) | undefined;
  const waitForRelease = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    await waitForRelease;
    return Response.json({
      success: true,
      tripId: "trip-test-001",
      tripStatus: TRIP_STATUS.ON_BUS,
      boardingMethod: BOARDING_METHOD.USER_CONFIRMED,
      boardingConfirmedAt: "2026-08-22T01:00:00.000Z",
      message: "버스 탑승을 확인했습니다.",
      timestamp: "2026-08-22T01:00:00.000Z",
    });
  };

  try {
    const first = dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-boarding-a",
        name: "confirm_boarding",
        arguments: "{}",
      },
      createContext(actions),
    );
    const second = dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-boarding-b",
        name: "confirm_boarding",
        arguments: "{}",
      },
      createContext(actions),
    );

    releaseFetch?.();
    const [firstEvents, secondEvents] = await Promise.all([first, second]);

    assert.equal(fetchCalls, 1);
    if (
      firstEvents[0]?.type === "conversation.item.create" &&
      secondEvents[0]?.type === "conversation.item.create"
    ) {
      assert.equal(firstEvents[0].item.call_id, "call-boarding-a");
      assert.equal(secondEvents[0].item.call_id, "call-boarding-b");
    } else {
      assert.fail("expected function_call_output events");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
