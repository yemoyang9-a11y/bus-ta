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
  bleIsMock: null as boolean | null,
  beaconScanActive: false,
  // 지팡이 연결과 대상 비콘 지정이 끝났는지. 서버의 스캔 시작 신호가 준비보다 먼저
  // 도착할 수 있어서, 준비 완료를 별도 값으로 들고 있어야 그때 스캔을 시작할 수 있다.
  caneReady: false,
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
      };

    case "CONFIRM_BOARDING":
      return {
        ...state,
        tripStatus: action.tripStatus as string | null,
        boardingMethod: action.boardingMethod as string | null,
        boardingConfirmedAt: action.boardingConfirmedAt as string | null,
      };

    case "UPDATE_TRIP_STATUS": {
      const s = (action.status ?? {}) as Record<string, unknown>;
      return {
        ...state,
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
