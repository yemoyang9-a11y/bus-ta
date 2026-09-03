import type {
  BoardingMethod,
  CreateTripRequest,
  RealtimeSessionResponse,
  Route,
} from "@bus-ta/shared";

export type RealtimeFunctionName =
  | "search_routes"
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
  | { type: "SET_DESTINATION_AND_ROUTES"; destination: string; routes: Route[] }
  | { type: "SELECT_ROUTE"; route: Route }
  | { type: "START_TRIP"; tripId: string }
  | {
      type: "CONFIRM_BOARDING";
      tripStatus: "ON_BUS" | "NEAR_DESTINATION";
      boardingMethod: BoardingMethod;
      boardingConfirmedAt: string;
    }
  | { type: "UPDATE_TRIP_STATUS"; status: unknown }
  | { type: "RESET_TRIP_KEEP_SEARCH" }
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
    };

export type ApiErrorResult = {
  success: false;
  errorCode: string;
  message: string;
  timestamp: string;
};

export type CreateRealtimeSessionResponse = RealtimeSessionResponse;
