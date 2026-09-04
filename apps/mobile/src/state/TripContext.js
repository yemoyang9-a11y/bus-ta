import React, { createContext, useContext, useReducer } from 'react';
import { initialState, tripReducer } from './trip-reducer';

// 상태와 reducer 는 trip-reducer.ts 에 있다. 이 파일은 JSX 를 갖고 있어 테스트에서
// 불러올 수 없는데, RESET_TRIP_KEEP_SEARCH 처럼 실제 dispatch 경로를 고정해야 하는
// 로직이 그 안에 섞여 있으면 검증할 방법이 없다(예모님 지적, PR #47).
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
