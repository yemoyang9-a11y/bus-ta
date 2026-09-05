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
import {
  clearActiveTripContext,
  clearActiveTripContextKeepSearch,
} from "./context";
import { assertActiveTripId } from "./function-guards";
import type {
  ApiErrorResult,
  RealtimeClientEvent,
  RealtimeFunctionCallEvent,
  RealtimeGuideContext,
  RealtimeFunctionName,
} from "./types";

type NextRouteCandidatesResult = {
  success: true;
  candidates: Route[];
  exhausted: boolean;
  expired?: boolean;
};

type SearchRoutesResultWithGuidedIds = RoutesSearchResponse & {
  guidedCandidateIds?: number[];
};

type EndTripModelResult = EndTripResponse & {
  destination: string | null;
  routes: Route[];
  expired: boolean;
};

type FunctionResult =
  | RoutesSearchResponse
  | BoardingConfirmationResponse
  | TripStatusResponse
  | CreateTripResponse
  | EndTripResponse
  | NextRouteCandidatesResult
  | ApiErrorResult;

type ModelFunctionResult =
  | FunctionResult
  | EndTripModelResult
  | (CreateTripResponse & { boardingStation: Route["boardingStation"] });

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
    "방금 전달된 Function 결과만 근거로 사용자에게 짧고 명확한 한국어 음성 안내를 생성한다. Function 결과가 오기 전의 추측은 사용하지 않는다. 내부 식별자와 오류 코드는 그대로 읽지 않는다. routeNo는 먼저 하이픈(-)을 기준으로 나누고 하이픈 양쪽 숫자를 이어 붙여 전체 자릿수를 계산하지 않는다. 나뉜 각 숫자 덩어리가 네 자리 이상이면 각 숫자를 한 자리씩 읽고, 세 자리 이하면 일반적인 한국어 수 읽기 방식으로 읽는다. 알파벳, 하이픈 뒤 숫자, 괄호 안 표시는 생략하지 않는다. 숫자-숫자 형태의 routeNo를 말할 때 하이픈(-)은 반드시 '다시'라고 읽고, '대시'나 '하이픈'이라고 읽거나 생략하지 않는다.";

  if (name === "search_routes") {
    return `${common} success가 true이고 routes가 빈 배열일 때만 조건에 맞는 노선 후보가 없다고 안내한다. success가 false이면 result.message의 원인을 바꾸어 말하지 않고, 위치 확인 실패나 API 오류를 노선 없음으로 안내하지 않는다. 후보가 있으면 각 후보의 routeNo, totalTime, intervalTime을 사용해 \"OO번은 예상 소요시간이 N분이고 배차 간격은 M분입니다\" 형식으로 최대 두 개를 모두 설명하고, 마지막에 반드시 \"어떤 버스를 선택하시겠어요?\"라고 묻는다. 값이 없는 시간은 추측하지 말고 확인할 수 없다고 말한다.`;
  }

  // 예모님 확정(2026-08-28, 예외상황 1번): "다른 버스 없어요?"에 새 검색 없이
  // 앱에 보관된 후보 중 다음 2개를 candidates 필드로 안내한다. expired가 true이면
  // 5분 TTL이 지난 상태이므로 candidates를 무시하고 재검색을 유도해야 한다.
  if (name === "get_next_route_candidates") {
    return `${common} expired가 true이면 이전에 검색한 노선 후보가 오래되어 더 이상 사용할 수 없다고 안내하고, 목적지를 다시 말씀해 달라고 요청한다. 이 경우 candidates는 절대 안내하지 않는다. expired가 true가 아니고 candidates가 비어 있지 않으면, 각 후보를 routeNo와 boardingStation, destinationStation을 사용해 안내하고, guideMessage가 있으면 그대로 활용한다. exhausted가 true이면(candidates가 비어 있고 expired도 아니면) 더 이상 안내할 다른 노선 후보가 없다고 말하고 새로 검색할지 묻는다.`;
  }

  if (name === "create_trip") {
    return `${common} create_trip 성공은 실제 탑승 완료가 아니라 WAITING_BUS 상태의 탑승 대기 시작이다. 성공 결과이면 \"OO번 버스를 선택했습니다. OO 정류장에서 기다려 주세요.\"라고 routeNo와 앱이 제공한 탑승 정류장을 안내한다. arrivals의 첫 항목이 있으면 predictedArrivalMinutes를 사용해 \"버스는 약 N분 후 도착합니다.\"라고 반드시 말한다. arrivals가 비어 있으면 시간을 추측하지 말고 \"현재 실시간 버스 도착정보를 확인할 수 없습니다\"라고 반드시 말한다. 이 응답에서는 절대 \"탑승했습니다\", \"탑승 중입니다\", \"운행을 시작합니다\"라고 말하지 않는다. 두 번째 차량은 사용자가 물을 때만 안내한다.`;
  }

  // 도착 예정 시간 안내의 단일 기준.
  //
  // 예모님 확정(2026-08-27, 예외상황 3번): WAITING_BUS 의 get_trip_status 응답에는
  // arrivals·arrivalStatus 가 포함된다. NO_VEHICLE(정상 조회, 차량 없음)과
  // UPSTREAM_ERROR(조회 실패)를 절대 같은 문장으로 합치면 안 된다 — 조회 실패를
  // "버스가 없다"고 안내하면 실제로는 오고 있는 버스를 사용자가 포기하게 된다.
  //
  // 2026-09-05 시연: AI 가 노선 선택 직후 들은 5분을 계속 반복했다. 전역 프롬프트가
  // 도착 예정 시간을 create_trip 전용으로 묶어 두었기 때문이다. 이 Function 은 매번
  // 서버가 갱신한 값을 들고 오므로 답변 근거를 방금 받은 결과로 못박는다.
  if (name === "get_trip_status") {
    return `${common} 도착 예정 시간과 남은 정류장 수는 방금 전달된 이 get_trip_status 결과만 근거로 말한다. 이전 create_trip 응답, 앞선 대화에서 안내했던 도착 시간, 앱이 기억하던 값은 절대 다시 사용하지 않는다. arrivalStatus 가 AVAILABLE 이면 arrivals의 첫 항목 predictedArrivalMinutes 를 사용해 \"버스는 약 N분 후 도착합니다\"처럼 안내한다. NO_VEHICLE 이면 조회는 됐고 지금 이 정류장에 오는 해당 노선 차량이 없다고 안내하며, 이때는 다른 노선을 제안해도 된다. NO_PREDICTION 이면 차가 없다고 단정하지 말고 도착시간 정보를 확인할 수 없다고 안내한다. UPSTREAM_ERROR 이면 \"지금은 도착 정보를 확인할 수 없습니다\"라고만 안내하고, 절대 버스가 없다거나 차량이 없다는 취지로 말하지 않으며, arrivals 에 값이 남아 있어도 그것을 방금 확인한 최신 도착시간처럼 말하지 않는다. \"버스를 놓쳤다\"는 발화 뒤에 이 결과가 왔더라도 그 발화만으로 운행 자체를 취소하지 않는다. \"몇 정류장 남았어요?\"의 뜻은 탑승 전후가 다르다. tripStatus 가 WAITING_BUS 이면 remainingStations 를 버스가 승차 정류장까지 남긴 정류장 수로 말하지 않고, 남은 정류장 수는 확인할 수 없다고 밝힌 뒤 최신 도착 예정 시간을 안내한다. tripStatus 가 ON_BUS 또는 NEAR_DESTINATION 이면 remainingStations 를 목적지까지 남은 정류장 수로 안내한다.`;
  }

  if (name === "confirm_boarding") {
    return `${common} success가 true인 서버 응답을 받은 경우에만 "탑승이 확인되었습니다. 하차까지 남은 정류장을 안내하겠습니다."라고 안내한다. success가 false이면 탑승이 확인됐다고 말하지 말고 result.message의 확인된 실패 원인만 짧게 안내한 뒤 다시 시도할지 묻는다. boardingMethod, boardingConfirmedAt, tripStatus 같은 내부 필드명은 읽지 않는다.`;
  }

  if (name === "end_trip") {
    return `${common} success가 true이면 선택한 운행만 취소된 것이다. expired가 true이면 오래된 후보를 안내하지 말고 다시 검색할지 묻는다. expired가 false이고 result.routes가 있으면 취소한 노선은 다시 말하지 말고, 새 검색도 하지 않은 채 전달된 다른 후보를 routeNo, totalTime, intervalTime으로 안내한 뒤 "어떤 버스를 선택하시겠어요?"라고 묻는다. result.routes가 비어 있을 때만 안내할 다른 보관 후보가 없다고 설명하고 다시 검색할지 묻는다. success가 false이면 후보를 다시 안내하거나 취소됐다고 말하지 말고 result.message의 확인된 실패 원인만 안내한다.`;
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

  const modelResult = buildModelFunctionResult(event.name, args, result, context);
  const candidateIdsToMark = collectCandidateIdsToMark(event.name, result, modelResult);
  // end_trip 성공 시 Context가 즉시 초기화돼도 직전 검색 후보를 잃지 않도록
  // 모델 결과를 먼저 만든 뒤 상태를 갱신한다.
  updateContext(event.name, args, result, context);

  const responseEvent: RealtimeClientEvent = {
    type: "response.create",
    response: {
      instructions: buildFunctionResponseInstructions(event.name),
    },
  };

  if (candidateIdsToMark.length > 0) {
    responseEvent.candidateIdsToMark = candidateIdsToMark;
  }

  return [
    {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify(modelResult),
      },
    },
    responseEvent,
  ];
}

// 예모님 재지적(2026-08-28, P1): search_routes로 최초 안내한 상위 2개 후보도
// get_next_route_candidates와 동일하게, 실제 오디오 출력 완료 후 MARK_CANDIDATES_ANNOUNCED로
// 기록되어야 한다. 그렇지 않으면 검색 직후 "다른 버스 없어요?"라고 물었을 때 방금 안내한
// 1·2위가 다시 나올 수 있다. search_routes 성공 시 상위 2개(guidedCandidateIds)를
// updateContext에서 SearchRoutesResultWithGuidedIds에 함께 실어 보내고, 여기서 그대로 꺼내 쓴다.
function collectCandidateIdsToMark(
  name: RealtimeFunctionName,
  result: FunctionResult,
  modelResult: ModelFunctionResult,
): number[] {
  if (result.success !== true) {
    return [];
  }

  if (name === "get_next_route_candidates") {
    const nextResult = result as NextRouteCandidatesResult;
    if (nextResult.expired) {
      return [];
    }
    return nextResult.candidates.map((route) => route.candidateId);
  }

  if (name === "search_routes") {
    const searchResult = result as SearchRoutesResultWithGuidedIds;
    return searchResult.guidedCandidateIds ?? [];
  }

  if (name === "end_trip" && "routes" in modelResult) {
    return modelResult.routes.map((route) => route.candidateId);
  }

  return [];
}

function buildModelFunctionResult(
  name: RealtimeFunctionName,
  args: unknown,
  result: FunctionResult,
  context: RealtimeGuideContext,
): ModelFunctionResult {
  if (name === "end_trip" && result.success === true) {
    const appState = context.getAppState();
    const expired =
      !appState.routeCandidatesExpiresAt ||
      Date.now() > appState.routeCandidatesExpiresAt;
    const cancelledCandidateId = appState.selectedRoute?.candidateId;
    const routes = expired
      ? []
      : ((appState.routeCandidates ?? []) as Route[])
          .filter((route) => route.candidateId !== cancelledCandidateId)
          .slice(0, 2);

    return {
      ...(result as EndTripResponse),
      destination: appState.destination,
      routes,
      expired,
    };
  }

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
  if (
    result.success !== true ||
    (name !== "confirm_boarding" && name !== "end_trip")
  ) {
    return result;
  }

  const tripResult = result as BoardingConfirmationResponse | EndTripResponse;
  if (tripResult.tripId === context.getAppState().tripId) {
    return result;
  }

  return {
    success: false,
    errorCode: "STALE_TRIP_CONTEXT",
    message: "활성 운행이 변경되어 이전 운행의 응답을 적용하지 않았습니다.",
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
    [
      "search_routes",
      "get_next_route_candidates",
      "create_trip",
      "confirm_boarding",
      "get_trip_status",
      "end_trip",
    ].includes(value.name)
  );
}

async function callBackendFunction(
  name: RealtimeFunctionName,
  args: unknown,
  context: RealtimeGuideContext,
): Promise<FunctionResult> {
  switch (name) {
    case "search_routes": {
      const result = await apiClient.routes.search(await assertRoutesSearchRequest(args, context));
      // 예모님 재지적(2026-08-28, P1): 최초 안내되는 상위 2개(guidedCandidateIds)를
      // 결과에 함께 실어서, collectCandidateIdsToMark가 실제 오디오 완료 후 기록할 수 있게 한다.
      if (result.success === true) {
        const guidedCandidateIds = (result.routes as Route[])
          .slice(0, 2)
          .map((route) => route.candidateId);
        return { ...result, guidedCandidateIds } as SearchRoutesResultWithGuidedIds;
      }
      return result;
    }
    case "get_next_route_candidates": {
      assertEmptyObject(args);
      const appState = context.getAppState();

      // 예모님 지적(2026-08-28, P1): routeCandidatesExpiresAt이 TripContext에 저장만
      // 되고 이 경로에서 확인되지 않아, 검색 후 5분이 지나도 기존 후보가 계속 재사용될
      // 수 있었다. 만료됐으면 기존 후보를 쓰지 않고 expired: true로 알려서, AI가
      // "다시 검색해 달라"고 안내하도록 한다(운행 자체를 여기서 취소하지 않는다).
      if (
        !appState.routeCandidatesExpiresAt ||
        Date.now() > appState.routeCandidatesExpiresAt
      ) {
        return {
          success: true,
          candidates: [],
          exhausted: true,
          expired: true,
        };
      }

      const routeCandidates = (appState.routeCandidates ?? []) as Route[];
      const announcedCandidateIds = appState.announcedCandidateIds ?? [];
      const nextCandidates = routeCandidates
        .filter((route) => !announcedCandidateIds.includes(route.candidateId))
        .slice(0, 2);

      return {
        success: true,
        candidates: nextCandidates,
        exhausted: nextCandidates.length === 0,
      };
    }
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
    case "get_trip_status": {
      // 예모님 확인(2026-08-27, exception-1-2): 서버가 이제 매 호출마다 GBIS를 다시 조회해서
      // arrivals·arrivalStatus를 실제 값으로 채워준다. 더 이상 mock으로 덮지 않는다.
      // 예모님 재지적(2026-08-28, P1): "버스 놓쳤어요" 발화 시 Realtime tool이 넘기는
      // refreshArrivals: true를 그동안 무시하고 있었다. Function 인자에서 읽어서
      // apiClient.trips.getStatus로 그대로 전달한다.
      const value = assertRecord(args);
      const refreshArrivals = value.refreshArrivals === true;
      return apiClient.trips.getStatus(assertTripId(args, context), { refreshArrivals });
    }
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

    if (statusResult.tripStatus === "CANCELLED") {
      clearActiveTripContextKeepSearch(context);
    } else if (statusResult.tripStatus === "TRIP_DONE") {
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
    clearActiveTripContextKeepSearch(context);
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
