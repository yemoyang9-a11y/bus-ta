import React, { createContext, useContext, useReducer } from 'react';

// 앱 전체 운행 상태 관리 (2026-08-12, 예모님 확정 구조)
// TripContext가 운행 상태의 유일한 원본(source of truth)이다.
const initialState = {
  destination: null,
  routeCandidates: null,
  announcedCandidateIds: [], // 효린님 문서(2026-08-27) 1번: AI가 이미 안내한 후보 candidateId 추적,
                              // "다른 버스 없어요?"에 중복 안내하지 않기 위해 사용
  selectedRoute: null,
  tripId: null,
  tripStatus: null,
  boardingMethod: null,
  boardingConfirmedAt: null,
  remainingStations: null,
  currentStation: null,
  bellStatus: null,
  guideMessage: null,
  beaconScanActive: false,
  bleIsMock: null,
};

function tripReducer(state, action) {
  switch (action.type) {
    case 'SET_DESTINATION_AND_ROUTES':
      // 새 검색 결과이므로 이전 검색에서 안내했던 후보 기록은 초기화한다.
      return {
        ...state,
        destination: action.destination,
        routeCandidates: action.routes,
        announcedCandidateIds: [],
      };
    // 효린님 문서(2026-08-27) 1번: AI가 특정 후보를 음성으로 안내했을 때 호출.
    // "다른 버스 없어요?"라고 물으면 이 목록에 없는 후보만 다음 안내 대상으로 고른다.
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
      };
    case 'UPDATE_TRIP_STATUS':
      return {
        ...state,
        tripStatus: action.status.tripStatus,
        boardingMethod: action.status.boardingMethod,
        boardingConfirmedAt: action.status.boardingConfirmedAt,
        remainingStations: action.status.remainingStations,
        currentStation: action.status.currentStation,
        bellStatus: action.status.bellStatus,
        guideMessage: action.status.guideMessage,
      };
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
    // 효린님 확인(2026-08-27): 사용자 취소(end_trip)는 tripId·선택 후보·운행 진행 상태만
    // 지우고, destination·routeCandidates는 남겨서 사용자가 처음부터 다시 검색하지
    // 않아도 되게 한다. GPS 전송 중단(stoppedRef 등)은 호출부에서 그대로 처리한다.
    case 'RESET_TRIP_KEEP_SEARCH':
      return {
        ...initialState,
        destination: state.destination,
        routeCandidates: state.routeCandidates,
        announcedCandidateIds: state.announcedCandidateIds,
      };
    // 정상 종료(TRIP_DONE)나 오류(TRIP_NOT_FOUND)는 검색 결과까지 포함해 전체 초기화한다.
    case 'RESET_TRIP':
      return { ...initialState };
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