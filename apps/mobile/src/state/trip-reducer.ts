import { resetTripKeepingSearch } from "./trip-transition";

// 예모님 확정(2026-08-28): 후보 유효시간 5분
export const ROUTE_CANDIDATES_TTL_MS = 5 * 60 * 1000;

// 초기 상태 — 노선 검색부터 하차까지 화면 간 공유되는 값
export const initialState = {
  destination: null as unknown,
  routeCandidates: null as unknown[] | null,
  // 예모님 확정(2026-08-28): 검색 성공 시점 + 5분. 앱 재시작 시 메모리 상태 자체가
  // 초기화되므로 별도 처리 없이 자연스럽게 폐기된다.
  routeCandidatesExpiresAt: null as number | null,
  announcedCandidateIds: [] as unknown[],
  selectedRoute: null as unknown,
  tripId: null as string | null,
  tripStatus: null as string | null,
  boardingMethod: null as string | null,
  boardingConfirmedAt: null as string | null,
  currentStation: null as unknown,
  nextStation: null as unknown,
  remainingStations: null as number | null,
  guideMessage: null as string | null,
  bellStatus: "NOT_REQUESTED" as string,
  bellRequestId: null as string | null,
  command: null as string | null,
  lastFunctionResult: null as unknown,
  lastInjectedStatus: null as unknown,
  // 승차 정류장에 오는 차량 정보. 대기 중 GET /status 응답에만 실려 오고, 3초 주기
  // PATCH /status 응답에는 없다. AI 가 "몇 분 남았어?"에 답할 때 쓰는 최신 근거이므로
  // 화면 state 가 아니라 공통 상태에 둔다.
  arrivals: null as unknown[] | null,
  arrivalStatus: null as string | null,          // AVAILABLE | NO_VEHICLE | NO_PREDICTION | UPSTREAM_ERROR
  nextArrivalRefreshInMs: null as number | null, // 다음 도착정보 조회까지 기다릴 시간(서버가 정한다)
  shouldScanBeacon: false,                       // 서버가 판단한 비콘 스캔 시작 신호
  bleIsMock: null as boolean | null,
  beaconScanActive: false,

  // 지팡이 연결과 대상 비콘 지정이 끝났는지. 서버의 스캔 시작 신호가 준비보다 먼저
  // 도착할 수 있어서, 준비 완료를 별도 값으로 들고 있어야 그때 스캔을 시작할 수 있다.
  caneReady: false,

  // 이번 노선의 하차벨(버스 비콘 겸용) 보드 이름. 서버가 노선별로 내려준다.
  // 탑승이 확정된 뒤 이 이름으로 하차벨을 연결한다.
  targetBeaconId: null as string | null,

  // 비콘 조회/준비 작업 자체가 완료됐는지.
  // false인 동안에는 targetBeaconId가 아직 늦게 들어올 수 있으므로
  // targetBeaconId가 null이어도 하차벨 연결 실패로 확정하면 안 된다.
  beaconPreparationCompleted: false,

  // 하차벨 연결 시도의 결과. null 이면 아직 시도하지 않았다는 뜻이다.
  bellConnected: null as boolean | null,
};

export type TripState = typeof initialState;

/**
 * 화면에서 dispatch 하는 액션. 필드는 액션마다 다르므로 느슨하게 받는다.
 * 기존 JS reducer 를 그대로 옮긴 것이라 여기서 엄격한 판별 유니온을 만들지 않는다.
 */
type TripAction = { type: string; [key: string]: unknown };

/**
 * TripContext 의 reducer.
 *
 * 예모님 지적(2026-09-04, PR #47 P1): 이 reducer 는 원래 TripContext.js 안에 있었는데
 * RESET_TRIP_KEEP_SEARCH 가 resetTripKeepingSearch 를 import 없이 호출하고 있었다.
 * 사용자가 운행을 취소하면 ReferenceError 가 나면서 tripId 가 초기화되지 않고, 그러면
 * 비콘 스캔 재시도의 "취소되면 더 시도하지 않는다" 보장도 함께 깨진다.
 *
 * TripContext.js 는 JSX 를 갖고 있어 테스트에서 불러올 수 없었다. 그래서 reducer 를
 * 여기로 옮겨 실제 dispatch 경로를 테스트로 고정한다.
 */
// 탑승한 뒤에는 승차 정류장의 도착정보가 의미를 잃는다. 남겨 두면 AI 가 운행 중에도
// "버스가 3분 뒤 도착합니다"라고 말할 근거를 계속 갖게 된다.
const CLEARED_ARRIVAL_FIELDS = {
  arrivals: null,
  arrivalStatus: null,
  nextArrivalRefreshInMs: null,
  shouldScanBeacon: false,
} satisfies Pick<
  TripState,
  "arrivals" | "arrivalStatus" | "nextArrivalRefreshInMs" | "shouldScanBeacon"
>;

/**
 * 서버 응답에서 도착정보 네 필드를 어떻게 반영할지 정한다.
 *
 * 이 네 필드는 대기 중 GET /status 응답에만 있고 3초 주기 PATCH /status 응답에는 없다.
 * 없는 값을 그대로 덮어쓰면 GET 이 방금 받아 온 최신 도착시간이 곧바로 지워져, 화면과
 * AI 가 다시 근거 없는 상태가 된다. 그래서 세 경우로 나눈다.
 *
 * 1. 응답에 도착정보가 있으면 그대로 최신 값으로 바꾼다.
 * 2. 없고 대기 상태도 벗어났으면(탑승 확정·종료) 명시적으로 정리한다.
 * 3. 없지만 아직 대기 중이면(PATCH 응답) 직전 GET 의 최신 값을 유지한다.
 *
 * realtime/event-dispatcher.ts 도 같은 규칙을 쓴다 — 그쪽이 임박 안내의 판정 기준이라
 * 여기서만 유지하면 안내가 두 번 나간다.
 */
function resolveArrivalFields(
  state: TripState,
  status: Record<string, unknown>,
): Pick<
  TripState,
  "arrivals" | "arrivalStatus" | "nextArrivalRefreshInMs" | "shouldScanBeacon"
> {
  if (status.arrivals !== undefined || status.arrivalStatus !== undefined) {
    return {
      arrivals: (status.arrivals as unknown[] | null) ?? null,
      arrivalStatus: (status.arrivalStatus as string | null) ?? null,
      nextArrivalRefreshInMs: (status.nextArrivalRefreshInMs as number | null) ?? null,
      shouldScanBeacon: status.shouldScanBeacon === true,
    };
  }

  if (status.tripStatus !== "WAITING_BUS") {
    return CLEARED_ARRIVAL_FIELDS;
  }

  return {
    arrivals: state.arrivals,
    arrivalStatus: state.arrivalStatus,
    nextArrivalRefreshInMs: state.nextArrivalRefreshInMs,
    shouldScanBeacon: state.shouldScanBeacon,
  };
}

export function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case "SET_DESTINATION_AND_ROUTES":
      // 새 검색 결과이므로 이전 검색에서 안내했던 후보 기록과 만료 시각을 새로 계산한다.
      return {
        ...state,
        destination: action.destination,
        routeCandidates: action.routes as unknown[] | null,
        routeCandidatesExpiresAt: Date.now() + ROUTE_CANDIDATES_TTL_MS,
        announcedCandidateIds: [],
      };

    case "MARK_CANDIDATES_ANNOUNCED":
      return {
        ...state,
        announcedCandidateIds: [
          ...new Set([
            ...state.announcedCandidateIds,
            ...((action.candidateIds as unknown[]) ?? []),
          ]),
        ],
      };

    case "SELECT_ROUTE":
      return {
        ...state,
        selectedRoute: action.route,
      };

    case "START_TRIP":
      return {
        ...state,
        tripId: action.tripId as string | null,
        tripStatus: "WAITING_BUS",
        boardingMethod: null,
        boardingConfirmedAt: null,
        targetBeaconId: null,
        beaconPreparationCompleted: false,
        bellConnected: null,
      };

    case "CONFIRM_BOARDING":
      return {
        ...state,
        ...CLEARED_ARRIVAL_FIELDS,
        tripStatus: action.tripStatus as string | null,
        boardingMethod: action.boardingMethod as string | null,
        boardingConfirmedAt: action.boardingConfirmedAt as string | null,
      };

    case "UPDATE_TRIP_STATUS": {
      const s = (action.status ?? {}) as Record<string, unknown>;
      return {
        ...state,
        ...resolveArrivalFields(state, s),
        tripStatus: s.tripStatus as string | null,
        boardingMethod: s.boardingMethod as string | null,
        boardingConfirmedAt: s.boardingConfirmedAt as string | null,
        currentStation: s.currentStation,
        nextStation: s.nextStation,
        remainingStations: s.remainingStations as number | null,
        guideMessage: s.guideMessage as string | null,
        bellStatus: s.bellStatus as string,
        bellRequestId: s.bellRequestId as string | null,
        command: s.command as string | null,
      };
    }

    case "SET_LAST_INJECTED_STATUS":
      return {
        ...state,
        lastInjectedStatus: action.status,
      };

    case "SET_BLE_MOCK_STATUS":
      return {
        ...state,
        bleIsMock: action.isMock as boolean | null,
      };

    case "SET_BEACON_SCAN_ACTIVE":
      return {
        ...state,
        beaconScanActive: action.active as boolean,
      };

    case "SET_CANE_READY":
      // 지팡이가 대상 비콘을 알게 됐다. 이제 스캔 명령을 받을 수 있다.
      return {
        ...state,
        caneReady: action.ready as boolean,
      };

    case "SET_TARGET_BEACON_ID":
      return {
        ...state,
        targetBeaconId: action.targetBeaconId as string | null,
      };

    case "SET_BEACON_PREPARATION_COMPLETED":
      return {
        ...state,
        beaconPreparationCompleted: action.completed as boolean,
      };

    case "SET_BELL_CONNECTED":
      return {
        ...state,
        bellConnected: action.connected as boolean | null,
      };

    // 운행만 종료하고, 유효한 기존 목적지·후보 노선(및 TTL, 안내 기록)은 유지한다.
    case "RESET_TRIP_KEEP_SEARCH":
      return resetTripKeepingSearch(initialState, state);

    // TRIP_DONE, TRIP_NOT_FOUND 발생 시 호출 — 다음 운행을 위해 전체 초기화
    case "RESET_TRIP":
      return {
        ...initialState,
        beaconScanActive: state.beaconScanActive,
      };

    default:
      return state;
  }
}