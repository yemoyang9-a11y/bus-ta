import type {
  BoardingMethod,
  CreateTripRequest,
  RealtimeSessionResponse,
  Route,
} from "@bus-ta/shared";

export type RealtimeFunctionName =
  | "search_routes"
  | "get_next_route_candidates"
  | "create_trip"
  | "confirm_boarding"
  | "get_trip_status"
  | "end_trip";

export type RealtimeFunctionCallEvent = {
  type: "response.function_call_arguments.done";
  call_id: string;
  name: RealtimeFunctionName;
  arguments: string;
};

export type RealtimeTransport = {
  send(event: unknown): void;
};

// 상태 변화 감지의 대상이 되는 필드만 담은 축소본 (event-dispatcher.ts에서 사용)
export type TripStatusSnapshot = {
  tripStatus: string | null;
  boardingMethod: BoardingMethod | null;
  boardingConfirmedAt: string | null;
  remainingStations: number | null;
  currentStation: { stationName: string } | null;
  bellStatus: string;
  guideMessage: string | null;
};

// 서버 상태 변화를 세션에 알리는 시스템 이벤트
export type TripStatusChangedEvent = {
  type: "trip_status_changed";
  tripStatus: string | null;
  boardingMethod: BoardingMethod | null;
  boardingConfirmedAt: string | null;
  remainingStations: number | null;
  currentStationName: string | null;
  bellStatus: string;
  guideMessage: string | null;
};

// TripContext(state/TripContext.js)의 state 구조와 대응한다.
export type AppTripState = {
  destination: string | null;
  routeCandidates: Route[] | null;

  // 예모님 확정(2026-08-28): 검색 성공 시점 + 5분(TTL). 이 시각이 지나면 기존
  // routeCandidates를 재사용하지 않고 재검색해야 한다.
  routeCandidatesExpiresAt: number | null;

  // 예외상황 1번:
  // AI가 이미 안내한 노선 후보의 candidateId를 기록한다.
  announcedCandidateIds: number[];

  selectedRoute: Route | null;
  tripId: string | null;
  tripStatus: string | null;
  boardingMethod: BoardingMethod | null;
  boardingConfirmedAt: string | null;
  currentStation: { stationName: string } | null;
  nextStation: unknown;
  remainingStations: number | null;
  guideMessage: string | null;
  bellStatus: string;
  bellRequestId: string | null;
  command: string | null;
  lastFunctionResult: unknown;
  lastInjectedStatus: TripStatusSnapshot | null;
};

export type AppAction =
  | {
      type: "SET_DESTINATION_AND_ROUTES";
      destination: string;
      routes: Route[];
    }
  | {
      // 예외상황 1번:
      // 실제 음성 안내가 완료된 후보만 기록한다.
      type: "MARK_CANDIDATES_ANNOUNCED";
      candidateIds: number[];
    }
  | { type: "SELECT_ROUTE"; route: Route }
  | { type: "START_TRIP"; tripId: string }
  | {
      type: "CONFIRM_BOARDING";
      tripStatus: "ON_BUS" | "NEAR_DESTINATION";
      boardingMethod: BoardingMethod;
      boardingConfirmedAt: string;
    }
  | { type: "UPDATE_TRIP_STATUS"; status: unknown }
  | { type: "RESET_TRIP" }
  | { type: "SET_LAST_INJECTED_STATUS"; status: TripStatusSnapshot };

// Realtime Dispatcher가 TripContext 상태를 읽고 쓰기 위한 창구.
export type RealtimeGuideContext = {
  getAppState(): AppTripState;
  getCurrentLocation(): { latitude: number; longitude: number } | undefined;
  refreshCurrentLocation(): Promise<void>;
  dispatchAppAction(action: AppAction): void;
  lastFunctionResult?: unknown;
};

export type RealtimeClientEvent =
  | {
      type: "conversation.item.create";
      item: {
        type: "function_call_output";
        call_id: string;
        output: string;
      };
    }
  | {
      type: "response.create";
      response?: {
        instructions?: string;
      };

      // 앱 내부 메타데이터.
      // OpenAI 서버로 그대로 보내는 값이 아니라 session.ts가 PendingResponse에
      // 옮겨 담고, 해당 음성 응답이 성공적으로 끝났을 때 안내 완료 처리에 사용한다.
      candidateIdsToMark?: number[];
    };

export type ApiErrorResult = {
  success: false;
  errorCode: string;
  message: string;
  timestamp: string;
};

export type CreateRealtimeSessionResponse = RealtimeSessionResponse;