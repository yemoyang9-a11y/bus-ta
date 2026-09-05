import type {
  ArrivalInfo,
  ArrivalStatus,
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
  /**
   * 승차 정류장에 오는 차량 정보. 대기 중 GET /status 응답에만 실려 온다.
   *
   * 3초 주기 PATCH /status 응답에는 이 세 필드가 아예 없어서 `undefined` 로 온다.
   * 그때 직전 값을 지우면 임박 판정 기준이 사라지므로, event-dispatcher 가
   * 마지막으로 확인된 값을 이어 받는다.
   */
  arrivalStatus?: ArrivalStatus | null;
  arrivals?: ArrivalInfo[] | null;
  nextArrivalRefreshInMs?: number | null;
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
  /**
   * 이 이벤트를 만든 시점의 도착정보. 안내 판단은 배열이 비었는지가 아니라
   * arrivalStatus 를 기준으로 한다 — 조회 실패도 빈 배열로 오기 때문이다.
   */
  arrivalStatus: ArrivalStatus | null;
  predictedArrivalMinutes: number[];
};

export type AssistDevice = "CANE" | "BELL" | "BOTH";

export type AssistDeviceFailureReason =
  | "NOT_CONNECTED"
  | "BEACON_NOT_REGISTERED"
  | "BEACON_LOOKUP_FAILED"
  | "COMMAND_FAILED";

// 앱이 확인한 보조기기 준비 실패를 Realtime 세션에 전달하는 시스템 이벤트.
// attempted=false이면 실제 BLE 스캔 전 단계에서 실패한 것이므로 기기 탓으로 안내하지 않는다.
export type AssistDeviceStatusChangedEvent = {
  type: "assist_device_status_changed";
  device: AssistDevice;
  status: "UNAVAILABLE";
  reason: AssistDeviceFailureReason;
  attempted: boolean;
  retryable: boolean;
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
  // 대기 중 GET /status 가 갱신하는 최신 도착정보. PATCH 응답에는 없으므로
  // reducer(state/trip-reducer.js)가 직전 값을 유지한다.
  arrivals?: ArrivalInfo[] | null;
  arrivalStatus?: ArrivalStatus | null;
  nextArrivalRefreshInMs?: number | null;
  shouldScanBeacon?: boolean;
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
  | { type: "RESET_TRIP_KEEP_SEARCH" }
  | { type: "RESET_TRIP" }
  | { type: "SET_BLE_MOCK_STATUS"; isMock: boolean }
  | { type: "SET_CANE_READY"; ready: boolean }
  | { type: "SET_BEACON_SCAN_ACTIVE"; active: boolean }
  | { type: "SET_TARGET_BEACON_ID"; targetBeaconId: string | null }
  | { type: "SET_BEACON_PREPARATION_COMPLETED"; completed: boolean }
  | { type: "SET_BELL_CONNECTED"; connected: boolean | null }
  | {
      // 예모님 지적(2026-08-28): 음성 end_trip(사용자 취소) 성공 시,
      // destination·routeCandidates·announcedCandidateIds는 남기고 나머지만
      // 초기화하는 액션. RidingScreen.js에서 화면 터치 취소 시 이미 쓰고 있던
      // 것과 동일한 계약을 음성 경로에도 맞춘다.
      type: "RESET_TRIP_KEEP_SEARCH";
    }
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