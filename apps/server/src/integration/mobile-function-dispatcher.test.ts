import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARDING_METHOD,
  TRIP_STATUS,
} from "@bus-ta/shared";
import type { Route } from "@bus-ta/shared";
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
  routeCandidatesExpiresAt: null,

  // 예외상황 1번:
  // AI가 이미 안내한 후보의 candidateId를 보관한다.
  announcedCandidateIds: [],

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

function createContext(
  actions: AppAction[],
  state: AppTripState = baseState,
): RealtimeGuideContext {
  return {
    getAppState: () => state,
    getCurrentLocation: () => undefined,
    refreshCurrentLocation: async () => {},
    dispatchAppAction: (action) => actions.push(action),
  };
}

function makeRoute(
  candidateId: number,
  routeNo: string,
): Route {
  return {
    candidateId,
    routeNo,
    localBusId: `local-${candidateId}`,
    gbisStationId: `station-${candidateId}`,
    boardingStation: {
      stationName: "수원대학교",
      latitude: 37.2,
      longitude: 126.9,
    },
    destinationStation: {
      stationName: "수원역",
      latitude: 37.26,
      longitude: 127.0,
    },
    stationList: [
      {
        stationName: "수원대학교",
        latitude: 37.2,
        longitude: 126.9,
        sequence: 1,
      },
      {
        stationName: "수원역",
        latitude: 37.26,
        longitude: 127.0,
        sequence: 2,
      },
    ],
    totalTime: 20 + candidateId,
    intervalTime: 10 + candidateId,
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

test("accepts get_next_route_candidates as a Realtime function event", () => {
  assert.equal(
    isRealtimeFunctionCallEvent({
      type: "response.function_call_arguments.done",
      call_id: "call-next-routes-1",
      name: "get_next_route_candidates",
      arguments: "{}",
    }),
    true,
  );
});

test("explicit voice function supplies active trip and USER_CONFIRMED evidence to the API", async () => {
  const actions: AppAction[] = [];
  const requests: Array<{
    url: string;
    body: Record<string, unknown>;
  }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(
        String(init?.body),
      ) as Record<string, unknown>,
    });

    return Response.json({
      success: true,
      tripId: "trip-test-001",
      tripStatus: TRIP_STATUS.ON_BUS,
      boardingMethod:
        BOARDING_METHOD.USER_CONFIRMED,
      boardingConfirmedAt:
        "2026-08-22T01:00:00.000Z",
      message: "버스 탑승을 확인했습니다.",
      timestamp: "2026-08-22T01:00:00.000Z",
    });
  };

  try {
    const events =
      await dispatchRealtimeFunctionCall(
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
    assert.equal(
      requests[0]?.body.boardingMethod,
      BOARDING_METHOD.USER_CONFIRMED,
    );
    assert.match(
      String(requests[0]?.body.requestId),
      /^boarding-trip-test-001-/,
    );

    assert.deepEqual(actions, [
      {
        type: "CONFIRM_BOARDING",
        tripStatus: TRIP_STATUS.ON_BUS,
        boardingMethod:
          BOARDING_METHOD.USER_CONFIRMED,
        boardingConfirmedAt:
          "2026-08-22T01:00:00.000Z",
      },
    ]);

    assert.equal(
      events[0]?.type,
      "conversation.item.create",
    );

    if (
      events[0]?.type ===
      "conversation.item.create"
    ) {
      assert.equal(
        events[0].item.call_id,
        "call-boarding-1",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects model-supplied boarding identifiers instead of forwarding them", async () => {
  const actions: AppAction[] = [];
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };

  try {
    const events =
      await dispatchRealtimeFunctionCall(
        {
          type: "response.function_call_arguments.done",
          call_id:
            "call-boarding-invalid-args",
          name: "confirm_boarding",
          arguments: JSON.stringify({
            tripId: "model-invented-trip",
            requestId:
              "model-invented-request",
            boardingMethod:
              BOARDING_METHOD.AUTO_DETECTED,
          }),
        },
        createContext(actions),
      );

    assert.equal(fetchCalls, 0);
    assert.deepEqual(actions, []);

    assert.equal(
      events[0]?.type,
      "conversation.item.create",
    );

    if (
      events[0]?.type !==
      "conversation.item.create"
    ) {
      assert.fail(
        "expected function_call_output event",
      );
    }

    const output = JSON.parse(
      events[0].item.output,
    ) as Record<string, unknown>;

    assert.equal(output.success, false);
    assert.equal(
      output.errorCode,
      "FUNCTION_DISPATCH_FAILED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent confirm calls share one API request but preserve each Realtime call_id", async () => {
  const actions: AppAction[] = [];
  let fetchCalls = 0;
  let releaseFetch: (() => void) | undefined;

  const waitForRelease =
    new Promise<void>((resolve) => {
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
      boardingMethod:
        BOARDING_METHOD.USER_CONFIRMED,
      boardingConfirmedAt:
        "2026-08-22T01:00:00.000Z",
      message: "버스 탑승을 확인했습니다.",
      timestamp: "2026-08-22T01:00:00.000Z",
    });
  };

  try {
    const first =
      dispatchRealtimeFunctionCall(
        {
          type: "response.function_call_arguments.done",
          call_id: "call-boarding-a",
          name: "confirm_boarding",
          arguments: "{}",
        },
        createContext(actions),
      );

    const second =
      dispatchRealtimeFunctionCall(
        {
          type: "response.function_call_arguments.done",
          call_id: "call-boarding-b",
          name: "confirm_boarding",
          arguments: "{}",
        },
        createContext(actions),
      );

    releaseFetch?.();

    const [firstEvents, secondEvents] =
      await Promise.all([
        first,
        second,
      ]);

    assert.equal(fetchCalls, 1);

    if (
      firstEvents[0]?.type ===
        "conversation.item.create" &&
      secondEvents[0]?.type ===
        "conversation.item.create"
    ) {
      assert.equal(
        firstEvents[0].item.call_id,
        "call-boarding-a",
      );

      assert.equal(
        secondEvents[0].item.call_id,
        "call-boarding-b",
      );
    } else {
      assert.fail(
        "expected function_call_output events",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not apply a delayed confirmation response to a different active trip", async () => {
  const actions: AppAction[] = [];

  let currentState: AppTripState = {
    ...baseState,
    tripId: "trip-A",
  };

  let releaseFetch:
    | ((response: Response) => void)
    | undefined;

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });

  const context: RealtimeGuideContext = {
    getAppState: () => currentState,
    getCurrentLocation: () => undefined,
    refreshCurrentLocation: async () => {},
    dispatchAppAction: (action) =>
      actions.push(action),
  };

  try {
    const pending =
      dispatchRealtimeFunctionCall(
        {
          type: "response.function_call_arguments.done",
          call_id: "call-trip-A",
          name: "confirm_boarding",
          arguments: "{}",
        },
        context,
      );

    await new Promise((resolve) =>
      setTimeout(resolve, 0),
    );

    currentState = {
      ...currentState,
      tripId: "trip-B",
      tripStatus:
        TRIP_STATUS.WAITING_BUS,
    };

    releaseFetch?.(
      Response.json({
        success: true,
        tripId: "trip-A",
        tripStatus: TRIP_STATUS.ON_BUS,
        boardingMethod:
          BOARDING_METHOD.USER_CONFIRMED,
        boardingConfirmedAt:
          "2026-08-22T01:00:00.000Z",
        message:
          "버스 탑승을 확인했습니다.",
        timestamp:
          "2026-08-22T01:00:00.000Z",
      }),
    );

    const events = await pending;

    assert.deepEqual(actions, []);

    assert.equal(
      events[0]?.type,
      "conversation.item.create",
    );

    if (
      events[0]?.type !==
      "conversation.item.create"
    ) {
      assert.fail(
        "expected function_call_output event",
      );
    }

    const output = JSON.parse(
      events[0].item.output,
    ) as Record<string, unknown>;

    assert.equal(output.success, false);
    assert.equal(
      output.errorCode,
      "STALE_TRIP_CONTEXT",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("get_next_route_candidates excludes already announced candidates and returns the next two in original order", async () => {
  const actions: AppAction[] = [];

  const routes = [
    makeRoute(1, "100"),
    makeRoute(2, "200"),
    makeRoute(3, "300"),
    makeRoute(4, "400"),
    makeRoute(5, "500"),
  ];

  const state: AppTripState = {
    ...baseState,
    routeCandidates: routes,
    routeCandidatesExpiresAt: Date.now() + 60_000,
    announcedCandidateIds: [1, 2],
  };

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error(
      "get_next_route_candidates must not call backend",
    );
  };

  try {
    const events =
      await dispatchRealtimeFunctionCall(
        {
          type: "response.function_call_arguments.done",
          call_id:
            "call-next-routes-1",
          name: "get_next_route_candidates",
          arguments: "{}",
        },
        createContext(actions, state),
      );

    // 새 경로 검색이나 백엔드 호출이 없어야 한다.
    assert.equal(fetchCalls, 0);

    // 아직 음성 안내가 완료된 것이 아니므로
    // MARK_CANDIDATES_ANNOUNCED도 여기서 즉시 dispatch하지 않는다.
    assert.deepEqual(actions, []);

    assert.equal(
      events[0]?.type,
      "conversation.item.create",
    );

    if (
      events[0]?.type !==
      "conversation.item.create"
    ) {
      assert.fail(
        "expected function_call_output event",
      );
    }

    const output = JSON.parse(
      events[0].item.output,
    ) as {
      success: boolean;
      candidates: Route[];
      exhausted: boolean;
    };

    assert.equal(output.success, true);
    assert.deepEqual(
      output.candidates.map(
        (route) => route.candidateId,
      ),
      [3, 4],
    );
    assert.equal(output.exhausted, false);

    const responseCreate = events[1];

    assert.equal(
      responseCreate?.type,
      "response.create",
    );

    if (
      responseCreate?.type !==
      "response.create"
    ) {
      assert.fail(
        "expected response.create event",
      );
    }

    assert.deepEqual(
      responseCreate.candidateIdsToMark,
      [3, 4],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("get_next_route_candidates returns exhausted without repeating candidates when all candidates were announced", async () => {
  const actions: AppAction[] = [];

  const routes = [
    makeRoute(1, "100"),
    makeRoute(2, "200"),
    makeRoute(3, "300"),
  ];

  const state: AppTripState = {
    ...baseState,
    routeCandidates: routes,
    routeCandidatesExpiresAt: Date.now() + 60_000,
    announcedCandidateIds: [1, 2, 3],
  };

  const events =
    await dispatchRealtimeFunctionCall(
      {
        type:
          "response.function_call_arguments.done",
        call_id:
          "call-next-routes-exhausted",
        name: "get_next_route_candidates",
        arguments: "{}",
      },
      createContext(actions, state),
    );

  assert.deepEqual(actions, []);

  assert.equal(
    events[0]?.type,
    "conversation.item.create",
  );

  if (
    events[0]?.type !==
    "conversation.item.create"
  ) {
    assert.fail(
      "expected function_call_output event",
    );
  }

  const output = JSON.parse(
    events[0].item.output,
  ) as {
    success: boolean;
    candidates: Route[];
    exhausted: boolean;
  };

  assert.equal(output.success, true);
  assert.deepEqual(output.candidates, []);
  assert.equal(output.exhausted, true);

  const responseCreate = events[1];

  assert.equal(
    responseCreate?.type,
    "response.create",
  );

  if (
    responseCreate?.type !==
    "response.create"
  ) {
    assert.fail(
      "expected response.create event",
    );
  }

  // 소진 안내에는 새로 기록할 후보가 없어 선택적 메타데이터를 생략한다.
  assert.equal(responseCreate.candidateIdsToMark, undefined);
});
