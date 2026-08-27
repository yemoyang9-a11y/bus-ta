import { apiClient, ApiError } from "../api/client";
import type {
  BoardingConfirmationResponse,
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
import { assertActiveTripId } from "./function-guards";
import type {
  ApiErrorResult,
  RealtimeClientEvent,
  RealtimeFunctionCallEvent,
  RealtimeGuideContext,
  RealtimeFunctionName,
} from "./types";

type FunctionResult =
  | RoutesSearchResponse
  | BoardingConfirmationResponse
  | TripStatusResponse
  | CreateTripResponse
  | EndTripResponse
  | ApiErrorResult;

// 동일 함수+인자 조합의 병렬 재호출 방지 (create_trip은 선택당 1회만 등)
const inFlightCalls = new Map<string, Promise<FunctionResult>>();
let boardingRequestSequence = 0;

function buildCallKey(
  event: RealtimeFunctionCallEvent,
  context: RealtimeGuideContext,
): string {
  if (event.name === "confirm_boarding") {
    return `${event.name}:${context.getAppState().tripId ?? "NO_ACTIVE_TRIP"}`;
  }
  return `${event.name}:${event.arguments}`;
}

function buildFunctionResponseInstructions(name: RealtimeFunctionName): string {
  const common =
    "방금 전달된 Function 결과만 근거로 사용자에게 짧고 명확한 한국어 음성 안내를 생성한다. Function 결과가 오기 전의 추측은 사용하지 않는다. 내부 식별자와 오류 코드는 그대로 읽지 않는다. routeNo의 숫자 부분이 네 자리 이상이면 각 숫자를 한 자리씩 읽고, 세 자리 이하면 일반적인 한국어 수 읽기 방식으로 읽는다. 알파벳, 하이픈 뒤 숫자, 괄호 안 표시는 생략하지 않는다. 숫자-숫자 형태의 routeNo를 말할 때 하이픈(-)은 반드시 '다시'라고 읽고, '대시'나 '하이픈'이라고 읽거나 생략하지 않는다.";

  if (name === "search_routes") {
    return `${common} success가 true이고 routes가 빈 배열일 때만 조건에 맞는 노선 후보가 없다고 안내한다. success가 false이면 result.message의 원인을 바꾸어 말하지 않고, 위치 확인 실패나 API 오류를 노선 없음으로 안내하지 않는다. 후보가 있으면 각 후보의 routeNo, totalTime, intervalTime을 사용해 \"OO번은 예상 소요시간이 N분이고 배차 간격은 M분입니다\" 형식으로 최대 두 개를 모두 설명하고, 마지막에 반드시 \"어떤 버스를 선택하시겠어요?\"라고 묻는다. 값이 없는 시간은 추측하지 말고 확인할 수 없다고 말한다.`;
  }

  if (name === "create_trip") {
    return `${common} create_trip 성공은 실제 탑승 완료가 아니라 WAITING_BUS 상태의 탑승 대기 시작이다. 성공 결과이면 \"OO번 버스를 선택했습니다. OO 정류장에서 기다려 주세요.\"라고 routeNo와 앱이 제공한 탑승 정류장을 안내한다. arrivals의 첫 항목이 있으면 predictedArrivalMinutes를 사용해 \"버스는 약 N분 후 도착합니다.\"라고 반드시 말한다. arrivals가 비어 있으면 시간을 추측하지 말고 \"현재 실시간 버스 도착정보를 확인할 수 없습니다\"라고 반드시 말한다. 이 응답에서는 절대 \"탑승했습니다\", \"탑승 중입니다\", \"운행을 시작합니다\"라고 말하지 않는다. 두 번째 차량은 사용자가 물을 때만 안내한다.`;
  }

  if (name === "confirm_boarding") {
    return `${common} success가 true인 서버 응답을 받은 경우에만 "탑승이 확인되었습니다. 하차까지 남은 정류장을 안내하겠습니다."라고 안내한다. success가 false이면 탑승이 확인됐다고 말하지 말고 result.message의 확인된 실패 원인만 짧게 안내한 뒤 다시 시도할지 묻는다. boardingMethod, boardingConfirmedAt, tripStatus 같은 내부 필드명은 읽지 않는다.`;
  }

  return common;
}

export async function dispatchRealtimeFunctionCall(
  event: RealtimeFunctionCallEvent,
  context: RealtimeGuideContext,
): Promise<RealtimeClientEvent[]> {
  const args = parseFunctionArguments(event.arguments);
  let result: FunctionResult;

  if (isApiErrorResult(args)) {
    result = args;
  } else {
    const callKey = buildCallKey(event, context);
    let callPromise = inFlightCalls.get(callKey);

    if (!callPromise) {
      callPromise = callBackendFunction(event.name, args, context)
        .catch(toApiErrorResult)
        .finally(() => {
          inFlightCalls.delete(callKey);
        });
      inFlightCalls.set(callKey, callPromise);
    }

    result = await callPromise;
    result = rejectStaleTripResult(event.name, result, context);
  }

  updateContext(event.name, args, result, context);
  const modelResult = buildModelFunctionResult(event.name, args, result, context);

  return [
    {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify(modelResult),
      },
    },
    {
      type: "response.create",
      response: {
        instructions: buildFunctionResponseInstructions(event.name),
      },
    },
  ];
}

function buildModelFunctionResult(
  name: RealtimeFunctionName,
  args: unknown,
  result: FunctionResult,
  context: RealtimeGuideContext,
): FunctionResult | (CreateTripResponse & { boardingStation: Route["boardingStation"] }) {
  if (name !== "create_trip" || result.success !== true || !("arrivals" in result)) {
    return result;
  }

  const selectedRoute = findSelectedRoute(args, context);
  return selectedRoute ? { ...result, boardingStation: selectedRoute.boardingStation } : result;
}

function rejectStaleTripResult(
  name: RealtimeFunctionName,
  result: FunctionResult,
  context: RealtimeGuideContext,
): FunctionResult {
  if (name !== "confirm_boarding" || result.success !== true) {
    return result;
  }

  const boardingResult = result as BoardingConfirmationResponse;
  if (boardingResult.tripId === context.getAppState().tripId) {
    return result;
  }

  return {
    success: false,
    errorCode: "STALE_TRIP_CONTEXT",
    message: "활성 운행이 변경되어 이전 탑승확정 응답을 적용하지 않았습니다.",
    timestamp: new Date().toISOString(),
  };
}

export function isRealtimeFunctionCallEvent(event: unknown): event is RealtimeFunctionCallEvent {
  if (event == null || typeof event !== "object") return false;

  const value = event as Record<string, unknown>;
  return (
    value.type === "response.function_call_arguments.done" &&
    typeof value.call_id === "string" &&
    typeof value.name === "string" &&
    typeof value.arguments === "string" &&
    ["search_routes", "create_trip", "confirm_boarding", "get_trip_status", "end_trip"].includes(value.name)
  );
}

async function callBackendFunction(
  name: RealtimeFunctionName,
  args: unknown,
  context: RealtimeGuideContext,
): Promise<FunctionResult> {
  switch (name) {
    case "search_routes":
      return apiClient.routes.search(await assertRoutesSearchRequest(args, context));
    case "create_trip":
      return apiClient.trips.create(assertCreateTripRequest(args, context));
    case "confirm_boarding": {
      assertEmptyObject(args);
      const tripId = assertCurrentTripId(context);
      return apiClient.trips.confirmBoarding(tripId, {
        requestId: createBoardingRequestId(tripId),
        boardingMethod: "USER_CONFIRMED",
      });
    }
    case "get_trip_status":
      return apiClient.trips.getStatus(assertTripId(args, context));
    case "end_trip": {
      const { tripId, body } = assertEndTripRequest(args, context);
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

  if (name === "confirm_boarding") {
    const boardingResult = result as BoardingConfirmationResponse;
    context.dispatchAppAction({
      type: "CONFIRM_BOARDING",
      tripStatus: boardingResult.tripStatus,
      boardingMethod: boardingResult.boardingMethod,
      boardingConfirmedAt: boardingResult.boardingConfirmedAt,
    });
    return;
  }

  if (name === "end_trip") {
    clearActiveTripContext(context);
  }
}

async function assertRoutesSearchRequest(
  args: unknown,
  context: RealtimeGuideContext,
): Promise<RoutesSearchRequest> {
  const value = assertRecord(args);

  // 좌표는 모델이 지어낼 수 있는 값이라 Function 인자에서 받지 않고,
  // 화면(GPS)이 갱신해 둔 실제 위치(getCurrentLocation)만 사용한다.
  let currentLocation = context.getCurrentLocation();
  if (!currentLocation) {
    // Realtime 연결이 GPS보다 먼저 완료된 경우, 검색 시점에 실제 위치를 한 번 더 요청한다.
    // 위치 실패는 WebRTC 연결을 끊지 않고 이 Function 호출만 오류로 처리한다.
    await context.refreshCurrentLocation().catch(() => undefined);
    currentLocation = context.getCurrentLocation();
  }

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

function assertTripId(args: unknown, context: RealtimeGuideContext): string {
  const value = assertRecord(args);
  return assertActiveTripId(value.tripId, context.getAppState().tripId);
}

function assertCurrentTripId(context: RealtimeGuideContext): string {
  const activeTripId = context.getAppState().tripId;
  return assertActiveTripId(activeTripId, activeTripId);
}

function createBoardingRequestId(tripId: string): string {
  boardingRequestSequence += 1;
  return `boarding-${tripId}-${Date.now()}-${boardingRequestSequence}`;
}

function assertEndTripRequest(
  args: unknown,
  context: RealtimeGuideContext,
): { tripId: string; body: UpdateTripRequest } {
  const value = assertRecord(args);
  const action = assertNonEmptyString(value.action, "action");

  if (action !== "CANCEL") {
    throw new Error("action은 CANCEL만 사용할 수 있습니다.");
  }

  return {
    tripId: assertActiveTripId(value.tripId, context.getAppState().tripId),
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

function assertEmptyObject(value: unknown): void {
  const record = assertRecord(value);
  if (Object.keys(record).length > 0) {
    throw new Error("confirm_boarding Function 인자는 빈 객체여야 합니다.");
  }
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
