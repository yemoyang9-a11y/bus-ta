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

// ── 노선 번호 발음을 데이터로 내려준다 ──────────────────────────────
//
// 시연에서 AI 가 35번을 "셋다섯", 15-2번을 "일번", 82-1번을 "팔십이번"으로 말했다.
// guide.ts 의 발음 규칙을 세 차례 조였는데도 계속 틀렸으므로, 발음을 앱이 계산해
// Function 결과에 실어 보내고 모델에는 "그대로 읽어라"만 시킨다.

test("get_trip_status 결과에 읽을 발음이 함께 실린다", async (t) => {
  stubTripStatusFetch(t, { ...waitingStatusBody, routeNo: "15-2" });

  const events = await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-spoken-1",
      name: "get_trip_status",
      arguments: JSON.stringify({ tripId: "trip-test-001" }),
    },
    createContext([]),
  );

  const output = readFunctionOutput(events);
  assert.equal(output.routeNoSpoken, "십오 다시 이");
  // 원본 표기는 모델에게 보내지 않는다. 보이면 모델이 그걸 제 방식으로 읽는다.
  // "실제 표기를 바꾸지 않는다"는 불변식은 앱 상태 쪽 테스트가 지킨다.
  assert.equal("routeNo" in output, false);
});

test("create_trip 결과에도 읽을 발음이 실린다", async (t) => {
  const route = makeRoute(1, "82-1");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      tripId: "trip-test-002",
      routeNo: "82-1",
      localBusId: "local-1",
      gbisStationId: "station-1",
      arrivals: [],
      tripStatus: TRIP_STATUS.WAITING_BUS,
      bellStatus: "NOT_REQUESTED",
      shouldTriggerBell: false,
      createdAt: "2026-09-05T01:00:00.000Z",
      message: "운행을 생성했습니다.",
      timestamp: "2026-09-05T01:00:00.000Z",
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const events = await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-spoken-2",
      name: "create_trip",
      arguments: JSON.stringify({ destination: "수원역", candidateId: 1 }),
    },
    createContext([], { ...baseState, routeCandidates: [route] }),
  );

  const output = readFunctionOutput(events);
  assert.equal(output.routeNoSpoken, "팔십이 다시 일");
});

test("후보 목록의 각 노선에도 발음이 실린다", async (t) => {
  // 후보를 고르는 단계가 잘못 들으면 가장 위험하다 — 다른 버스를 타게 된다.
  const routes = [makeRoute(1, "35"), makeRoute(2, "1551B")];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      tripId: "trip-test-003",
      tripStatus: TRIP_STATUS.CANCELLED,
      message: "운행 안내를 종료했습니다.",
      timestamp: "2026-09-05T01:00:00.000Z",
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const events = await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-spoken-3",
      name: "end_trip",
      arguments: JSON.stringify({ tripId: "trip-test-003", action: "CANCEL" }),
    },
    createContext([], {
      ...baseState,
      tripId: "trip-test-003",
      routeCandidates: routes,
      routeCandidatesExpiresAt: Date.now() + 60_000,
    }),
  );

  const output = readFunctionOutput(events);
  const returned = output.routes as Array<Record<string, unknown>>;
  assert.equal(returned.length, 2);
  assert.equal(returned[0]?.routeNoSpoken, "삼십오");
  assert.equal(returned[1]?.routeNoSpoken, "일 오 오 일 비");
});

test("전역 프롬프트가 발음을 직접 계산하지 말고 routeNoSpoken 을 읽게 한다", () => {
  const instructions = createRealtimeSessionUpdateEvent().session.instructions;

  assert.match(instructions, /routeNoSpoken/);
  assert.doesNotMatch(
    instructions,
    /각 숫자 덩어리가 네 자리 이상이면 숫자를 한 자리씩 끊어 읽는다/,
    "발음 계산을 모델에게 맡기는 규칙이 남아 있으면 다시 틀린 발음이 나온다",
  );
});

test("선택 전 도착 시간 질문을 거절로 끝내지 않고 선택으로 이어 준다", () => {
  // 기존 멘트는 "노선을 선택하신 뒤에 알려드릴 수 있어요"에서 끊겨, 화면을 볼 수 없는
  // 사용자가 다음에 무엇을 해야 하는지 알 수 없었다. 사실(선택 전에는 조회하지 않는다)은
  // 그대로 두고, 바로 다음 행동으로 이어지게 한다.
  const instructions = createRealtimeSessionUpdateEvent().session.instructions;

  assert.doesNotMatch(
    instructions,
    /"도착 시간은 노선을 선택하신 뒤에 알려드릴 수 있어요\."라고 답한다/,
    "거절로 끝나는 멘트가 남아 있으면 사용자가 다음 행동을 알 수 없다",
  );
  assert.match(instructions, /정해주시면 바로 도착 시간을 확인해 드릴게요/);
  assert.match(
    instructions,
    /아직 조회하지 않은 도착 시간을 추측해서 말하지 않는다/,
    "선택을 유도하면서 없는 시간을 지어내면 더 나쁘다",
  );
});

// ── 후보 경계 진단 로그 ──────────────────────────────────────────────
//
// 시연에서 "다른 버스 없어요?"에 AI 가 "다른 버스 정보를 불러올 수 없다"고 답했다.
// 코드 경로는 멀쩡하므로 런타임 상태 문제인데, 다음 네 가지가 구분되지 않는다.
//   (a) 서버가 애초에 2개만 줬다(노선 번호 중복 제거)
//   (b) 앱 상태에 후보가 저장되지 않았다
//   (c) 후보 유효시간(5분)이 지났다
//   (d) 모델이 함수를 아예 부르지 않았다
// 최초 안내는 Function 결과를 모델이 직접 읽어서 말하므로, 첫 안내가 정상이었다는
// 사실이 "앱이 후보를 저장했다"는 증거가 되지 못한다. 그래서 읽는 시점의 실제 상태를
// 남긴다. 좌표·키·외부 URL 은 남기지 않는다.

function captureConsoleLog(t: import("node:test").TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

function locatedContext(actions: AppAction[], state: AppTripState = baseState): RealtimeGuideContext {
  return {
    getAppState: () => state,
    getCurrentLocation: () => ({ latitude: 37.2433596, longitude: 126.9639028 }),
    refreshCurrentLocation: async () => {},
    dispatchAppAction: (action) => actions.push(action),
  };
}

test("검색 결과로 후보를 몇 개 보관하는지 남긴다", async (t) => {
  const lines = captureConsoleLog(t);
  const routes = [makeRoute(1, "35"), makeRoute(2, "700-2"), makeRoute(3, "82-1")];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ success: true, destination: "수원역", routes });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-cand-1",
      name: "search_routes",
      arguments: JSON.stringify({ destination: "수원역" }),
    },
    locatedContext([]),
  );

  const line = lines.find((l) => l.includes("[app/candidates] search result"));
  assert.ok(line, `검색 결과 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(line, /routes=3/);
  assert.match(line, /ids=\[1,2,3\]/);
  assert.match(line, /routeNos=\[35,700-2,82-1\]/, "중복 제거로 2개만 왔는지 여기서 드러난다");
  assert.doesNotMatch(line, /37\.24|126\.96/, "좌표를 남기면 안 된다");
});

test("다음 후보를 물어볼 때 읽은 앱 상태를 그대로 남긴다", async (t) => {
  // 저장이 실패했는지(storedCount=0), 유효시간이 지났는지(expiresAt 과거)를 가른다.
  const lines = captureConsoleLog(t);
  const routes = [makeRoute(1, "35"), makeRoute(2, "700-2"), makeRoute(3, "82-1")];

  await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-cand-2",
      name: "get_next_route_candidates",
      arguments: "{}",
    },
    createContext([], {
      ...baseState,
      routeCandidates: routes,
      routeCandidatesExpiresAt: Date.now() + 60_000,
      announcedCandidateIds: [1, 2],
    }),
  );

  const request = lines.find((l) => l.includes("[app/candidates] next request"));
  const result = lines.find((l) => l.includes("[app/candidates] next result"));

  assert.ok(request, `요청 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(request, /storedCount=3/);
  assert.match(request, /announced=\[1,2\]/);
  assert.match(request, /expiresAt=\d{4}-/, "만료 시각을 읽을 수 있어야 한다");

  assert.ok(result, `결과 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(result, /candidates=1/);
  assert.match(result, /exhausted=false/);
  assert.match(result, /expired=false/);
});

test("후보가 저장되지 않았으면 만료가 아니라 저장 실패로 드러난다", async (t) => {
  const lines = captureConsoleLog(t);

  await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-cand-3",
      name: "get_next_route_candidates",
      arguments: "{}",
    },
    createContext([], baseState),
  );

  const request = lines.find((l) => l.includes("[app/candidates] next request"));
  const result = lines.find((l) => l.includes("[app/candidates] next result"));

  assert.ok(request);
  assert.match(request, /storedCount=0/);
  assert.match(request, /expiresAt=none/, "값이 아예 없는 것과 과거인 것을 구분한다");
  assert.ok(result);
  assert.match(result, /expired=true/);
});

test("취소 후 재선택도 같은 후보 상태를 남긴다", async (t) => {
  // 예외상황 2번은 예외상황 1번과 같은 routeCandidatesExpiresAt 을 검사한다.
  // 원인이 하나면 두 로그가 같은 모습으로 나온다.
  const lines = captureConsoleLog(t);
  const routes = [makeRoute(1, "35"), makeRoute(2, "700-2")];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      tripId: "trip-cand",
      tripStatus: TRIP_STATUS.CANCELLED,
      message: "운행 안내를 종료했습니다.",
      timestamp: "2026-09-05T01:00:00.000Z",
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-cand-4",
      name: "end_trip",
      arguments: JSON.stringify({ tripId: "trip-cand", action: "CANCEL" }),
    },
    createContext([], {
      ...baseState,
      tripId: "trip-cand",
      routeCandidates: routes,
      routeCandidatesExpiresAt: Date.now() + 60_000,
      selectedRoute: routes[0]!,
    }),
  );

  // 다른 경계와 같은 모양으로 상태 한 줄, 결과 한 줄을 남긴다.
  const state = lines.find((l) => l.startsWith("[app/candidates] end_trip storedCount"));
  const result = lines.find((l) => l.startsWith("[app/candidates] end_trip result"));

  assert.ok(state, `취소 시점 후보 상태 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(state, /storedCount=2/);
  assert.match(state, /expiresAt=\d{4}-/);

  assert.ok(result, `취소 후보 결과 로그가 없다: ${JSON.stringify(lines)}`);
  assert.match(result, /expired=false/);
  assert.match(result, /returned=1/, "취소한 노선을 뺀 나머지가 몇 개인지");
});

// ── 모델에게 원본 노선 번호를 보여주지 않는다 ────────────────────
//
// 2026-09-05 실기기: routeNoSpoken 을 함께 실어 보내고 "그대로 읽어라"라고 지시했는데도
// 모델이 M4101 을 "엠 사천 일공일"처럼 제 방식으로 발음했다. 우리 변환 함수는
// "엠 사 일 공 일" 을 만들므로 그 소리가 나올 수 없다 — 모델이 옆에 있는 원본
// routeNo 를 보고 직접 발음한 것이다.
//
// "이 필드 말고 저 필드를 읽어라"는 결국 또 하나의 지시였다. 같은 방식으로 세 번
// 실패했으므로, 모델이 원본 표기를 아예 못 보게 한다. 보지 못한 문자열은 발음할 수 없다.
//
// 앱 상태에는 원본이 그대로 남아야 한다. 화면 표시와 create_trip 요청 본문이 그것을 쓴다.

test("모델 payload 에는 원본 routeNo 가 없고 발음형만 있다", async (t) => {
  const routes = [makeRoute(1, "M4101"), makeRoute(2, "720-1")];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, destination: "수원역", routes });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const events = await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-hide-1",
      name: "search_routes",
      arguments: JSON.stringify({ destination: "수원역" }),
    },
    locatedContext([]),
  );

  const payload = readFunctionOutput(events);
  const returned = payload.routes as Array<Record<string, unknown>>;

  assert.equal(returned[0]?.routeNoSpoken, "엠 사 일 공 일");
  assert.equal(returned[1]?.routeNoSpoken, "칠백이십 다시 일");
  for (const route of returned) {
    assert.equal(
      "routeNo" in route,
      false,
      `원본 표기가 남아 있으면 모델이 그걸 읽는다: ${JSON.stringify(route)}`,
    );
  }
  assert.doesNotMatch(JSON.stringify(payload), /M4101|720-1/, "payload 어디에도 원본이 없어야 한다");
});

test("앱 상태에는 원본 routeNo 가 그대로 남는다", async (t) => {
  // 화면 표시와 create_trip 요청 본문은 실제 표기를 써야 한다. 발음형을 저장하면
  // 서버에 "칠백이십 다시 일"이 노선 번호로 전달된다.
  const routes = [makeRoute(1, "M4101")];
  const actions: AppAction[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, destination: "수원역", routes });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-hide-2",
      name: "search_routes",
      arguments: JSON.stringify({ destination: "수원역" }),
    },
    locatedContext(actions),
  );

  const stored = actions.find((a) => a.type === "SET_DESTINATION_AND_ROUTES") as
    | { routes: Array<{ routeNo: string }> }
    | undefined;
  assert.ok(stored, "후보가 앱 상태에 저장돼야 한다");
  assert.equal(stored.routes[0]?.routeNo, "M4101");
});

test("운행 상태 조회 결과에도 원본 routeNo 를 남기지 않는다", async (t) => {
  stubTripStatusFetch(t, { ...waitingStatusBody, routeNo: "720-1" });

  const events = await dispatchRealtimeFunctionCall(
    {
      type: "response.function_call_arguments.done",
      call_id: "call-hide-3",
      name: "get_trip_status",
      arguments: JSON.stringify({ tripId: "trip-test-001" }),
    },
    createContext([]),
  );

  const payload = readFunctionOutput(events);
  assert.equal(payload.routeNoSpoken, "칠백이십 다시 일");
  assert.equal("routeNo" in payload, false);
});

test("create_trip 은 모델에게 candidateId 와 destination 만 요구한다", () => {
  // 원본 표기를 감췄으므로 모델은 routeNo·localBusId·정류장 목록을 채울 수 없다.
  // 어차피 Dispatcher 가 앱 상태의 실제 후보에서 다시 만들어 쓰던 값들이라,
  // 스키마에 남겨 두면 모델이 없는 값을 지어내게만 한다.
  const tools = createRealtimeSessionUpdateEvent().session.tools as ReadonlyArray<{
    name: string;
    parameters: { required: readonly string[]; properties: Record<string, unknown> };
  }>;
  const createTrip = tools.find((tool) => tool.name === "create_trip");

  assert.ok(createTrip);
  assert.deepEqual([...createTrip.parameters.required].sort(), ["candidateId", "destination"]);
  for (const gone of ["routeNo", "localBusId", "gbisStationId", "stationList"]) {
    assert.equal(
      gone in createTrip.parameters.properties,
      false,
      `${gone} 은 Dispatcher 가 채우므로 모델에게 묻지 않는다`,
    );
  }
});
