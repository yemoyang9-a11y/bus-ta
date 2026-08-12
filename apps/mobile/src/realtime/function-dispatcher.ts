import { apiClient, ApiError } from "../api/client";
import type {
  CreateTripResponse,
  CreateTripRequest,
  EndTripResponse,
  Route,
  RoutesSearchRequest,
  RoutesSearchResponse,
  TripStatusResponse,
  UpdateTripRequest,
} from "@bus-ta/shared";
import { clearActiveTripContext } from "./context";
import type {
  ApiErrorResult,
  RealtimeClientEvent,
  RealtimeFunctionCallEvent,
  RealtimeGuideContext,
  RealtimeFunctionName,
} from "./types";

type FunctionResult =
  | RoutesSearchResponse
  | TripStatusResponse
  | CreateTripResponse
  | EndTripResponse
  | ApiErrorResult;

// 동일 함수+인자 조합의 병렬 재호출 방지 (create_trip은 선택당 1회만 등)
const inFlightCalls = new Map<string, Promise<RealtimeClientEvent[]>>();

function buildCallKey(event: RealtimeFunctionCallEvent): string {
  return `${event.name}:${event.arguments}`;
}

export async function dispatchRealtimeFunctionCall(
  event: RealtimeFunctionCallEvent,
  context: RealtimeGuideContext,
): Promise<RealtimeClientEvent[]> {
  const callKey = buildCallKey(event);

  const existing = inFlightCalls.get(callKey);
  if (existing) return existing;

  const callPromise = executeFunctionCall(event, context).finally(() => {
    inFlightCalls.delete(callKey);
  });

  inFlightCalls.set(callKey, callPromise);
  return callPromise;
}

async function executeFunctionCall(
  event: RealtimeFunctionCallEvent,
  context: RealtimeGuideContext,
): Promise<RealtimeClientEvent[]> {
  const args = parseFunctionArguments(event.arguments);
  const result = isApiErrorResult(args)
    ? args
    : await callBackendFunction(event.name, args, context).catch(toApiErrorResult);

  updateContext(event.name, args, result, context);

  return [
    {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify(result),
      },
    },
    {
      type: "response.create",
      response: {
        instructions:
          "Function 결과만 근거로 사용자에게 짧고 명확한 한국어 음성 안내를 생성한다. 내부 식별자와 오류 코드는 그대로 읽지 않는다.",
      },
    },
  ];
}

export function isRealtimeFunctionCallEvent(event: unknown): event is RealtimeFunctionCallEvent {
  if (event == null || typeof event !== "object") return false;

  const value = event as Record<string, unknown>;
  return (
    value.type === "response.function_call_arguments.done" &&
    typeof value.call_id === "string" &&
    typeof value.name === "string" &&
    typeof value.arguments === "string" &&
    ["search_routes", "create_trip", "get_trip_status", "end_trip"].includes(value.name)
  );
}

async function callBackendFunction(
  name: RealtimeFunctionName,
  args: unknown,
  context: RealtimeGuideContext,
): Promise<FunctionResult> {
  switch (name) {
    case "search_routes":
      return apiClient.routes.search(assertRoutesSearchRequest(args, context));
    case "create_trip":
      return apiClient.trips.create(assertCreateTripRequest(args, context));
    case "get_trip_status":
      return apiClient.trips.getStatus(assertTripId(args));
    case "end_trip": {
      const { tripId, body } = assertEndTripRequest(args);
      return apiClient.trips.end(tripId, body);
    }
  }
}

// Function 처리 결과를 TripContext(dispatchAppAction)에 반영한다.
// RealtimeGuideContext는 더 이상 상태를 직접 들고 있지 않으므로, context.xxx = ... 대신
// context.dispatchAppAction({ type: ... })으로만 상태를 바꾼다.
function updateContext(
  name: RealtimeFunctionName,
  args: unknown,
  result: FunctionResult,
  context: RealtimeGuideContext,
) {
  context.lastFunctionResult = result;
  if (result.success !== true) return;

  if (name === "search_routes") {
    const searchResult = result as RoutesSearchResponse;
    context.dispatchAppAction({
      type: "SET_DESTINATION_AND_ROUTES",
      destination: searchResult.destination,
      routes: searchResult.routes as Route[],
    });
    return;
  }

  if (name === "create_trip") {
    const createResult = result as CreateTripResponse;
    const selectedRoute = findSelectedRoute(args, context);
    if (selectedRoute) {
      context.dispatchAppAction({ type: "SELECT_ROUTE", route: selectedRoute });
    }
    context.dispatchAppAction({ type: "START_TRIP", tripId: createResult.tripId });
    return;
  }

  if (name === "get_trip_status") {
    const statusResult = result as TripStatusResponse;
    context.dispatchAppAction({ type: "UPDATE_TRIP_STATUS", status: statusResult });

    if (statusResult.tripStatus === "CANCELLED" || statusResult.tripStatus === "TRIP_DONE") {
      clearActiveTripContext(context);
    }
    return;
  }

  if (name === "end_trip") {
    clearActiveTripContext(context);
  }
}

function assertRoutesSearchRequest(
  args: unknown,
  context: RealtimeGuideContext,
): RoutesSearchRequest {
  const value = assertRecord(args);

  // 좌표는 모델이 지어낼 수 있는 값이라 Function 인자에서 받지 않고,
  // 화면(GPS)이 갱신해 둔 실제 위치(getCurrentLocation)만 사용한다.
  const currentLocation = context.getCurrentLocation();
  if (!currentLocation) {
    throw new Error("현재 위치를 확인할 수 없습니다.");
  }

  return {
    destination: assertNonEmptyString(value.destination, "destination"),
    latitude: currentLocation.latitude,
    longitude: currentLocation.longitude,
  };
}

function findSelectedRoute(args: unknown, context: RealtimeGuideContext): Route | undefined {
  const value = assertRecord(args);
  const candidateId = assertPositiveInteger(value.candidateId, "candidateId");
  const appState = context.getAppState();
  const routeCandidates = (appState.routeCandidates ?? []) as Route[];
  return routeCandidates.find((route) => route.candidateId === candidateId);
}

function assertCreateTripRequest(
  args: unknown,
  context: RealtimeGuideContext,
): CreateTripRequest {
  const value = assertRecord(args);
  const selectedRoute = findSelectedRoute(args, context);

  if (selectedRoute == null) {
    throw new Error("선택한 경로 후보를 찾을 수 없습니다. 먼저 경로를 다시 검색해 주세요.");
  }

  const appState = context.getAppState();
  return toCreateTripRequest(
    selectedRoute,
    assertNonEmptyString(value.destination ?? appState.destination, "destination"),
  );
}

function toCreateTripRequest(selectedRoute: Route, destination: string): CreateTripRequest {
  const request: CreateTripRequest = {
    destination,
    candidateId: selectedRoute.candidateId,
    routeNo: selectedRoute.routeNo,
    localBusId: selectedRoute.localBusId,
    gbisStationId: selectedRoute.gbisStationId,
    boardingStation: selectedRoute.boardingStation,
    destinationStation: selectedRoute.destinationStation,
    stationList: selectedRoute.stationList,
  };

  if (selectedRoute.totalTime !== undefined) request.totalTime = selectedRoute.totalTime;
  if (selectedRoute.totalWalk !== undefined) request.totalWalk = selectedRoute.totalWalk;
  if (selectedRoute.payment !== undefined) request.payment = selectedRoute.payment;
  if (selectedRoute.busTransitCount !== undefined) {
    request.busTransitCount = selectedRoute.busTransitCount;
  }
  if (selectedRoute.busStationCount !== undefined) {
    request.busStationCount = selectedRoute.busStationCount;
  }
  if (selectedRoute.totalDistance !== undefined) request.totalDistance = selectedRoute.totalDistance;
  if (selectedRoute.intervalTime !== undefined) request.intervalTime = selectedRoute.intervalTime;

  return request;
}

function assertTripId(args: unknown): string {
  const value = assertRecord(args);
  return assertNonEmptyString(value.tripId, "tripId");
}

function assertEndTripRequest(args: unknown): { tripId: string; body: UpdateTripRequest } {
  const value = assertRecord(args);
  const action = assertNonEmptyString(value.action, "action");

  if (action !== "CANCEL") {
    throw new Error("action은 CANCEL만 사용할 수 있습니다.");
  }

  return {
    tripId: assertNonEmptyString(value.tripId, "tripId"),
    body: { action },
  };
}

function parseFunctionArguments(rawArguments: string): unknown | ApiErrorResult {
  try {
    return JSON.parse(rawArguments);
  } catch {
    return {
      success: false,
      errorCode: "INVALID_FUNCTION_ARGUMENTS",
      message: "Function 인자를 JSON으로 해석할 수 없습니다.",
      timestamp: new Date().toISOString(),
    };
  }
}

function toApiErrorResult(error: unknown): ApiErrorResult {
  if (error instanceof ApiError) {
    return {
      success: false,
      errorCode: error.errorCode,
      message: error.message,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    success: false,
    errorCode: "FUNCTION_DISPATCH_FAILED",
    message: error instanceof Error ? error.message : "Function 처리 중 오류가 발생했습니다.",
    timestamp: new Date().toISOString(),
  };
}

function isApiErrorResult(value: unknown): value is ApiErrorResult {
  return (
    value != null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).success === false
  );
}

function assertRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Function 인자는 객체여야 합니다.");
  }

  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} 값이 필요합니다.`);
  }

  return value;
}

function assertFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} 값은 숫자여야 합니다.`);
  }

  return value;
}

function assertPositiveInteger(value: unknown, fieldName: string): number {
  const numberValue = assertFiniteNumber(value, fieldName);

  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${fieldName} 값은 양의 정수여야 합니다.`);
  }

  return numberValue;
}