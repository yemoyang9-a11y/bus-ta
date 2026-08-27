import React, { createContext, useContext, useReducer } from 'react';

// 초기 상태 — 노선 검색부터 하차까지 화면 간 공유되는 값
const initialState = {
  destination: null,
  routeCandidates: null,   // 검색된 노선 후보 배열 (원본 그대로 보관, 재조립 금지)
  selectedRoute: null,     // 사용자가 선택한 노선 후보 객체
  tripId: null,
  tripStatus: null,        // WAITING_BUS | ON_BUS | NEAR_DESTINATION | TRIP_DONE | CANCELLED | ERROR
  boardingMethod: null,    // USER_CONFIRMED | AUTO_DETECTED
  boardingConfirmedAt: null,
  currentStation: null,
  nextStation: null,
  remainingStations: null,
  guideMessage: null,
  bellStatus: 'NOT_REQUESTED',
  bellRequestId: null,
  command: null,
  lastFunctionResult: null,   // Phase 5: Function Dispatcher가 마지막으로 처리한 결과
  lastInjectedStatus: null,   // Phase 6: 이벤트 Dispatcher가 마지막으로 세션에 주입한 상태
  bleIsMock: null,   // 예모님 코멘트 2번(2026-08-13): 하차벨 결과가 실제 BLE 응답인지, mock인지 표시
  beaconScanActive: false,   // 예모님 코멘트 P0-2(2026-08-14): 비콘 스캔이 실제로 시작됐는지 추적,
                              // stopBeaconScan() 성공 후에만 false로 바뀌어야 한다
};

function tripReducer(state, action) {
  switch (action.type) {
    case 'SET_DESTINATION_AND_ROUTES':
      // Realtime search_routes Function 성공 후 호출
      return {
        ...state,
        destination: action.destination,
        routeCandidates: action.routes,
      };

    case 'SELECT_ROUTE':
      // RouteListScreen에서 노선 선택 시 호출
      return {
        ...state,
        selectedRoute: action.route,
      };

    case 'START_TRIP':
      // RouteListScreen에서 create_trip 성공 후 호출
      return {
        ...state,
        tripId: action.tripId,
        tripStatus: 'WAITING_BUS',
        boardingMethod: null,
        boardingConfirmedAt: null,
      };

    case 'CONFIRM_BOARDING':
      // 서버의 원자 저장 성공 응답만 반영한다. 프론트가 자체적으로 ON_BUS를 만들지 않는다.
      return {
        ...state,
        tripStatus: action.tripStatus,
        boardingMethod: action.boardingMethod,
        boardingConfirmedAt: action.boardingConfirmedAt,
      };

    case 'UPDATE_TRIP_STATUS': {
      // RidingScreen에서 PATCH /status 응답 반영 시 호출
      // 서버 응답(action.status)을 그대로 신뢰해서 덮어씀 — 프론트에서 값 재계산 금지
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
      // event-dispatcher.ts가 세션에 이벤트를 보낸 뒤, 마지막으로 보낸 상태를 기록할 때 호출
      return {
        ...state,
        lastInjectedStatus: action.status,
      };

    case 'SET_BLE_MOCK_STATUS':
      // RouteListScreen에서 비콘 조회 + BLE 연결 시도 후 호출
      // 서버가 알려준 isMock과 실제 BLE 연결 성공 여부를 조합한 최종값을 저장
      return {
        ...state,
        bleIsMock: action.isMock,
      };

    case 'SET_BEACON_SCAN_ACTIVE':
      // RouteListScreen에서 startBeaconScan() 성공 시 true,
      // RidingScreen에서 stopBeaconScan() 성공 시 false로 호출
      return {
        ...state,
        beaconScanActive: action.active,
      };

    case 'RESET_TRIP':
      // TRIP_DONE, CANCELLED, TRIP_NOT_FOUND 발생 시 호출 — 다음 운행을 위해 초기화
      return {
        ...initialState,
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

// 화면에서 이 훅 하나로 상태와 dispatch를 모두 가져다 씀
export function useTrip() {
  const context = useContext(TripContext);
  if (!context) {
    throw new Error('useTrip은 TripProvider 내부에서만 사용할 수 있습니다.');
  }
  return context;
}
