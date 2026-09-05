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
import { createRealtimeSessionUpdateEvent } from "../../../mobile/src/realtime/guide.js";
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

test("get_trip_status forwards refreshArrivals only for an explicit forced refresh", async () => {
  const actions: AppAction[] = [];
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return Response.json({
      success: true,
      tripId: "trip-test-001",
      tripStatus: TRIP_STATUS.WAITING_BUS,
      boardingMethod: null,
      boardingConfirmedAt: null,
      currentStation: null,
      nextStation: null,
      remainingStations: 3,
      shouldTriggerBell: false,
      bellStatus: "NOT_REQUESTED",
      bellRequestId: null,
      command: null,
      guideMessage: "버스를 기다리고 있습니다.",
      arrivals: [],
      arrivalStatus: "NO_VEHICLE",
      shouldScanBeacon: false,
      nextArrivalRefreshInMs: 15_000,
      timestamp: "2026-09-03T00:00:00.000Z",
    });
  };

  try {
    await dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-refresh-arrivals",
        name: "get_trip_status",
        arguments: JSON.stringify({
          tripId: "trip-test-001",
          refreshArrivals: true,
        }),
      },
      createContext(actions),
    );

    await dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-normal-status",
        name: "get_trip_status",
        arguments: JSON.stringify({ tripId: "trip-test-001" }),
      },
      createContext(actions),
    );

    assert.deepEqual(requestedUrls, [
      "http://localhost:3000/api/trips/trip-test-001/status?refreshArrivals=true",
      "http://localhost:3000/api/trips/trip-test-001/status",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful end_trip excludes the cancelled route and returns two valid alternatives", async () => {
  const actions: AppAction[] = [];
  const routeCandidates = [
    makeRoute(1, "100"),
    makeRoute(2, "200"),
    makeRoute(3, "300"),
    makeRoute(4, "400"),
  ];
  const state: AppTripState = {
    ...baseState,
    routeCandidates,
    routeCandidatesExpiresAt: Date.now() + 60_000,
    selectedRoute: routeCandidates[0] ?? null,
  };
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    Response.json({
      success: true,
      tripId: "trip-test-001",
      tripStatus: TRIP_STATUS.CANCELLED,
      message: "운행 안내를 종료했습니다.",
      timestamp: "2026-09-03T10:00:00.000Z",
    });

  try {
    const events = await dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-end-trip-success",
        name: "end_trip",
        arguments: JSON.stringify({
          tripId: "trip-test-001",
          action: "CANCEL",
        }),
      },
      createContext(actions, state),
    );

    assert.deepEqual(actions, [{ type: "RESET_TRIP_KEEP_SEARCH" }]);
    if (events[0]?.type !== "conversation.item.create") {
      assert.fail("expected function_call_output event");
    }
    const output = JSON.parse(events[0].item.output) as {
      success: boolean;
      expired: boolean;
      routes: Route[];
    };
    assert.equal(output.success, true);
    assert.equal(output.expired, false);
    assert.deepEqual(
      output.routes.map((route) => route.candidateId),
      [2, 3],
    );
    if (events[1]?.type !== "response.create") {
      assert.fail("expected response.create event");
    }
    assert.deepEqual(events[1].candidateIdsToMark, [2, 3]);
    assert.match(events[1].response?.instructions ?? "", /취소한 노선은 다시 말하지 말고/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful end_trip does not expose expired candidates", async () => {
  const actions: AppAction[] = [];
  const routeCandidates = [makeRoute(1, "100"), makeRoute(2, "200")];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    Response.json({
      success: true,
      tripId: "trip-test-001",
      tripStatus: TRIP_STATUS.CANCELLED,
      message: "운행 안내를 종료했습니다.",
      timestamp: "2026-09-03T10:00:00.000Z",
    });

  try {
    const events = await dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-end-trip-expired",
        name: "end_trip",
        arguments: JSON.stringify({ tripId: "trip-test-001", action: "CANCEL" }),
      },
      createContext(actions, {
        ...baseState,
        routeCandidates,
        routeCandidatesExpiresAt: Date.now() - 1,
        selectedRoute: routeCandidates[0] ?? null,
      }),
    );

    if (events[0]?.type !== "conversation.item.create") {
      assert.fail("expected function_call_output event");
    }
    const output = JSON.parse(events[0].item.output) as {
      expired: boolean;
      routes: Route[];
    };
    assert.equal(output.expired, true);
    assert.deepEqual(output.routes, []);
    if (events[1]?.type !== "response.create") {
      assert.fail("expected response.create event");
    }
    assert.equal(events[1].candidateIdsToMark, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed end_trip keeps the active trip and does not expose saved routes", async () => {
  const actions: AppAction[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        success: false,
        errorCode: "INVALID_TRIP_STATUS",
        message: "이미 완료된 운행은 취소할 수 없습니다.",
        timestamp: "2026-09-03T10:00:00.000Z",
      },
      { status: 409 },
    );

  try {
    const events = await dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-end-trip-failure",
        name: "end_trip",
        arguments: JSON.stringify({ tripId: "trip-test-001", action: "CANCEL" }),
      },
      createContext(actions, {
        ...baseState,
        routeCandidates: [makeRoute(1, "100")],
      }),
    );
    assert.deepEqual(actions, []);
    if (events[0]?.type !== "conversation.item.create") {
      assert.fail("expected function_call_output event");
    }
    const output = JSON.parse(events[0].item.output) as Record<string, unknown>;
    assert.equal(output.success, false);
    assert.equal("routes" in output, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("delayed end_trip response cannot reset a newer active trip", async () => {
  const actions: AppAction[] = [];
  let currentState: AppTripState = {
    ...baseState,
    tripId: "trip-A",
    routeCandidates: [makeRoute(1, "100")],
    routeCandidatesExpiresAt: Date.now() + 60_000,
  };
  let releaseFetch: ((response: Response) => void) | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
  const context: RealtimeGuideContext = {
    getAppState: () => currentState,
    getCurrentLocation: () => undefined,
    refreshCurrentLocation: async () => {},
    dispatchAppAction: (action) => actions.push(action),
  };

  try {
    const pending = dispatchRealtimeFunctionCall(
      {
        type: "response.function_call_arguments.done",
        call_id: "call-end-trip-A",
        name: "end_trip",
        arguments: JSON.stringify({ tripId: "trip-A", action: "CANCEL" }),
      },
      context,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    currentState = { ...currentState, tripId: "trip-B" };
    releaseFetch?.(
      Response.json({
        success: true,
        tripId: "trip-A",
        tripStatus: TRIP_STATUS.CANCELLED,
        message: "운행 안내를 종료했습니다.",
        timestamp: "2026-09-03T10:00:00.000Z",
      }),
    );
    const events = await pending;
    assert.deepEqual(actions, []);
    if (events[0]?.type !== "conversation.item.create") {
      assert.fail("expected function_call_output event");
    }
    const output = JSON.parse(events[0].item.output) as Record<string, unknown>;
    assert.equal(output.success, false);
    assert.equal(output.errorCode, "STALE_TRIP_CONTEXT");
    assert.equal("routes" in output, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── 도착 예정 시간은 항상 최신 get_trip_status 결과가 기준이다 ──────────────
//
// 시연에서 AI는 노선 선택 직후 들은 5분을 계속 반복했다. 전역 프롬프트가 "도착 예정
// 시간은 create_trip 응답의 arrivals만 사용한다"고 지시하고 있었기 때문이다.
// 이후 질문에는 방금 받은 Function 결과만 근거가 되어야 한다.

function stubTripStatusFetch(
  t: import("node:test").TestContext,
  body: Record<string, unknown>,
) {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: unknown) => {
    calls.push(String(input));
    return Response.json(body);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  return calls;
}

const waitingStatusBody = {
  success: true,
  tripId: "trip-test-001",
  tripStatus: TRIP_STATUS.WAITING_BUS,
  boardingMethod: null,
  boardingConfirmedAt: null,
  currentStation: null,
  nextStation: null,
  remainingStations: 3,
  bellStatus: "NOT_REQUESTED",
  shouldTriggerBell: false,
  command: null,
  guideMessage: "버스 탑승을 기다리고 있습니다.",
  arrivals: [
    {
      predictedArrivalMinutes: 3,
      occupancy: { type: "UNAVAILABLE", congestionLevel: null, remainingSeats: null },
    },
  ],
  arrivalStatus: "AVAILABLE",
  nextArrivalRefreshInMs: 30_000,
  shouldScanBeacon: true,
  message: "현재 이동 상태를 조회했습니다.",
  timestamp: "2026-09-05T01:00:00.000Z",
};

function readInstructions(events: unknown[]): string {
  const responseEvent = events.find(
    (event) => (event as { type?: string }).type === "response.create",
  ) as { response?: { instructions?: string } } | undefined;
  return responseEvent?.response?.instructions ?? "";
}

function readFunctionOutput(events: unknown[]): Record<string, unknown> {
  const outputEvent = events.find(
    (event) => (event as { type?: string }).type === "conversation.item.create",
  ) as { item?: { output?: string } } | undefined;
  return JSON.parse(outputEvent?.item?.output ?? "{}") as Record<string, unknown>;
}

test("get_trip_status 결과는 최신 도착시간을 그대로 모델에 전달한다", async (t) => {
  stubTripStatusFetch(t, waitingStatusBody);

  const events = await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-status-1",
      name: "get_trip_status",
      arguments: JSON.stringify({ tripId: "trip-test-001" }),
    },
    createContext([]),
  );

  const output = readFunctionOutput(events);
  assert.deepEqual(output.arrivals, waitingStatusBody.arrivals);
  assert.equal(output.arrivalStatus, "AVAILABLE");
});

test("get_trip_status 전용 지시가 이전 create_trip 값을 쓰지 못하게 막는다", async (t) => {
  stubTripStatusFetch(t, waitingStatusBody);

  const events = await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-status-2",
      name: "get_trip_status",
      arguments: JSON.stringify({ tripId: "trip-test-001" }),
    },
    createContext([]),
  );

  const instructions = readInstructions(events);
  assert.match(instructions, /create_trip/, "이전 create_trip 값을 쓰지 말라고 명시해야 한다");
  assert.match(instructions, /AVAILABLE/);
  assert.match(instructions, /NO_VEHICLE/);
  assert.match(instructions, /NO_PREDICTION/);
  assert.match(instructions, /UPSTREAM_ERROR/);
});

test("탑승 전에는 remainingStations 를 승차까지 남은 정류장으로 안내하지 않게 한다", async (t) => {
  // "몇 정류장 남았어?"의 뜻이 탑승 전후로 다르다. 대기 중 remainingStations 는
  // 목적지까지 남은 수라 그대로 읽으면 "버스가 세 정류장 앞에 있다"로 오해된다.
  stubTripStatusFetch(t, waitingStatusBody);

  const events = await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-status-3",
      name: "get_trip_status",
      arguments: JSON.stringify({ tripId: "trip-test-001" }),
    },
    createContext([]),
  );

  const instructions = readInstructions(events);
  assert.match(instructions, /WAITING_BUS/);
  assert.match(instructions, /remainingStations/);
  assert.match(instructions, /ON_BUS|NEAR_DESTINATION/);
});

test("전역 프롬프트가 도착 예정 시간을 create_trip 전용으로 묶어 두지 않는다", () => {
  const sessionUpdate = createRealtimeSessionUpdateEvent();
  const instructions = sessionUpdate.session.instructions;

  assert.doesNotMatch(
    instructions,
    /도착 예정 시간은 create_trip 응답의 arrivals에 있는 predictedArrivalMinutes만 사용한다/,
    "이후 질문에도 create_trip 값을 쓰라는 지시가 남아 있으면 최신값이 무시된다",
  );
  assert.match(instructions, /get_trip_status/);
});

test("앱의 상태 조회 요청과 실제 수신값을 안전한 필드만으로 남긴다", async (t) => {
  // 서버는 3분을 보냈는데 앱은 5분을 들고 있는 경우를 이 두 줄로 가른다.
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  stubTripStatusFetch(t, waitingStatusBody);

  await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-status-log",
      name: "get_trip_status",
      arguments: JSON.stringify({ tripId: "trip-test-001", refreshArrivals: true }),
    },
    createContext([]),
  );

  const request = lines.find((line) => line.includes("[app/arrival] status request"));
  const response = lines.find((line) => line.includes("[app/arrival] status response"));

  assert.ok(request, `앱 요청 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(request, /tripId=trip-test-001/);
  assert.match(request, /refreshArrivals=true/);

  assert.ok(response, `앱 응답 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(response, /arrivalStatus=AVAILABLE/);
  assert.match(response, /predictedArrivalMinutes=\[3\]/);
  assert.match(response, /nextArrivalRefreshInMs=30000/);
  assert.doesNotMatch(response, /https?:\/\//);
});
