import React, { createContext, useContext, useReducer } from 'react';

// 예모님 확정(2026-08-28): 후보 유효시간 5분
const ROUTE_CANDIDATES_TTL_MS = 5 * 60 * 1000;

// 초기 상태 — 노선 검색부터 하차까지 화면 간 공유되는 값
const initialState = {
  destination: null,
  routeCandidates: null,
  routeCandidatesExpiresAt: null, // 예모님 확정(2026-08-28): 검색 성공 시점 + 5분. 앱 재시작 시
                                   // 메모리 상태 자체가 초기화되므로 별도 처리 없이 자연스럽게 폐기된다.
  announcedCandidateIds: [],
  selectedRoute: null,
  tripId: null,
  tripStatus: null,
  boardingMethod: null,
  boardingConfirmedAt: null,
  currentStation: null,
  nextStation: null,
  remainingStations: null,
  guideMessage: null,
  bellStatus: 'NOT_REQUESTED',
  bellRequestId: null,
  command: null,
  lastFunctionResult: null,
  lastInjectedStatus: null,
  bleIsMock: null,
  beaconScanActive: false,
};

function tripReducer(state, action) {
  switch (action.type) {
    case 'SET_DESTINATION_AND_ROUTES':
      // 새 검색 결과이므로 이전 검색에서 안내했던 후보 기록과 만료 시각을 새로 계산한다.
      return {
        ...state,
        destination: action.destination,
        routeCandidates: action.routes,
        routeCandidatesExpiresAt: Date.now() + ROUTE_CANDIDATES_TTL_MS,
        announcedCandidateIds: [],
      };

    case 'MARK_CANDIDATES_ANNOUNCED':
      return {
        ...state,
        announcedCandidateIds: [
          ...new Set([...state.announcedCandidateIds, ...action.candidateIds]),
        ],
      };

    case 'SELECT_ROUTE':
      return {
        ...state,
        selectedRoute: action.route,
      };

    case 'START_TRIP':
      return {
        ...state,
        tripId: action.tripId,
        tripStatus: 'WAITING_BUS',
        boardingMethod: null,
        boardingConfirmedAt: null,
      };

    case 'CONFIRM_BOARDING':
      return {
        ...state,
        tripStatus: action.tripStatus,
        boardingMethod: action.boardingMethod,
        boardingConfirmedAt: action.boardingConfirmedAt,
      };

    case 'UPDATE_TRIP_STATUS': {
      const s = action.status;
      return {
        ...state,
        tripStatus: s.tripStatus,
        boardingMethod: s.boardingMethod,
        boardingConfirmedAt: s.boardingConfirmedAt,
        currentStation: s.currentStation,
        nextStation: s.nextStation,
        remainingStations: s.remainingStations,
        guideMessage: s.guideMessage,
        bellStatus: s.bellStatus,
        bellRequestId: s.bellRequestId,
        command: s.command,
      };
    }

    case 'SET_LAST_INJECTED_STATUS':
      return {
        ...state,
        lastInjectedStatus: action.status,
      };

    case 'SET_BLE_MOCK_STATUS':
      return {
        ...state,
        bleIsMock: action.isMock,
      };

    case 'SET_BEACON_SCAN_ACTIVE':
      return {
        ...state,
        beaconScanActive: action.active,
      };

    case 'RESET_TRIP_KEEP_SEARCH':
      return {
        ...initialState,
        destination: state.destination,
        routeCandidates: state.routeCandidates,
        routeCandidatesExpiresAt: state.routeCandidatesExpiresAt,
        announcedCandidateIds: state.announcedCandidateIds,
        beaconScanActive: state.beaconScanActive,
      };

    case 'RESET_TRIP':
      return {
        ...initialState,
        beaconScanActive: state.beaconScanActive,
      };

    default:
      return state;
  }
}

const TripContext = createContext(null);

export function TripProvider({ children }) {
  const [state, dispatch] = useReducer(tripReducer, initialState);
  return (
    <TripContext.Provider value={{ state, dispatch }}>
      {children}
    </TripContext.Provider>
  );
}

export function useTrip() {
  const context = useContext(TripContext);
  if (!context) {
    throw new Error('useTrip은 TripProvider 내부에서만 사용할 수 있습니다.');
  }
  return context;
}

// 예모님 확정(2026-08-28): routeCandidates가 5분 TTL을 넘겼는지 확인하는 헬퍼.
// get_next_route_candidates(유나님 파트)나 화면에서, 후보를 사용하기 전에 이 함수로
// 만료 여부를 먼저 확인해서, 만료됐으면 기존 후보를 쓰지 않고 재검색하도록 판단할 수 있다.
export function isRouteCandidatesExpired(state) {
  if (!state.routeCandidatesExpiresAt) return true;
  return Date.now() > state.routeCandidatesExpiresAt;
}