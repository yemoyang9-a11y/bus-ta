import React, { createContext, useContext, useReducer } from 'react';

// 초기 상태 — 노선 검색부터 하차까지 화면 간 공유되는 값
const initialState = {
  destination: null,
  routeCandidates: null,
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
      return {
        ...state,
        destination: action.destination,
        routeCandidates: action.routes,
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

    // 유나님 지적(2026-08-28): beaconScanActive를 여기서 곧바로 false로 초기화하면,
    // RidingScreen의 취소 감지 useEffect가 실행될 때 이미 false라서 stopBeaconScan()을
    // 건너뛰게 된다(상태값만 꺼지고 실제 BLE 스캔은 계속 남을 수 있음). 그래서 이 액션은
    // beaconScanActive를 건드리지 않고 그대로 이전 값을 유지한다. 실제 스캔 중지는
    // RidingScreen이 stopBeaconScan()을 호출해서 "성공"한 뒤에만
    // SET_BEACON_SCAN_ACTIVE(active: false)를 별도로 dispatch해서 끈다.
    case 'RESET_TRIP_KEEP_SEARCH':
      return {
        ...initialState,
        destination: state.destination,
        routeCandidates: state.routeCandidates,
        announcedCandidateIds: state.announcedCandidateIds,
        beaconScanActive: state.beaconScanActive,
      };

    // 예모님 재지적(2026-08-28, P1): RESET_TRIP_KEEP_SEARCH와 같은 이유로, TRIP_DONE·
    // TRIP_NOT_FOUND에서도 beaconScanActive를 곧바로 false로 만들면 RidingScreen의
    // cleanup effect가 실제 stopBeaconScan() 호출을 건너뛸 수 있다. 이 액션도
    // beaconScanActive는 건드리지 않고 이전 값을 유지해서, 실제 스캔 중지가 성공한
    // 뒤에만 RidingScreen이 SET_BEACON_SCAN_ACTIVE(active: false)로 끄도록 한다.
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