import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useTrip } from '../state/TripContext';
import { HaneumRealtimeSession } from './session';
import { createRealtimeGuideContext } from './context';
import type { RealtimeWebRTCTransport } from './webrtc-transport';
import type { AppAction, AppTripState } from './types';

// 예모님 지침(2026-08-15): MainScreen이 연결 상태를 텍스트로 보여줘야 하므로 세분화한다.
export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

// RealtimeProvider가 화면에 제공하는 것
type RealtimeContextValue = {
  session: HaneumRealtimeSession | null;
  transport: RealtimeWebRTCTransport | null;
  isConnected: boolean;
  connectionStatus: RealtimeConnectionStatus;
  connectionError: string | null;
  connect: () => Promise<void>;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * TripContext(운행 상태의 유일한 원본)와 Realtime 세션을 연결한다.
 * TripProvider 아래에 위치해야 한다. (2026-08-12, 예모님 확정 구조)
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  // TripContext.js는 순수 JS라 타입 정보가 없으므로, 여기서 명시적으로 타입을 지정한다.
  const { state, dispatch } = useTrip() as {
    state: AppTripState;
    dispatch: (action: AppAction) => void;
  };

  const [transport, setTransport] = useState<RealtimeWebRTCTransport | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>('idle');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);

  // Function Dispatcher가 항상 최신 state/dispatch를 참조하도록 ref로 보관
  // (클로저에 갇힌 오래된 state를 참조하지 않기 위함)
  const stateRef = useRef(state);
  const dispatchRef = useRef(dispatch);
  stateRef.current = state;
  dispatchRef.current = dispatch;

  const currentLocationRef = useRef<{ latitude: number; longitude: number } | undefined>(undefined);

  const refreshCurrentLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    const location = await Location.getCurrentPositionAsync({});
    currentLocationRef.current = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  };

  // 위치 권한이 있으면 현재 위치를 주기적으로 갱신해 둔다.
  // search_routes 등에서 모델이 지어낼 수 없는 실제 좌표로만 쓰인다.
  useEffect(() => {
    let isMounted = true;

    (async () => {
      await refreshCurrentLocation();
      if (!isMounted) currentLocationRef.current = undefined;
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const sessionRef = useRef<HaneumRealtimeSession | null>(null);
  if (!sessionRef.current) {
    const guideContext = createRealtimeGuideContext({
      getAppState: () => stateRef.current,
      getCurrentLocation: () => currentLocationRef.current,
      dispatchAppAction: (action: AppAction) => dispatchRef.current(action),
    });
    sessionRef.current = new HaneumRealtimeSession(guideContext);
  }

  const connect = async () => {
    if (!sessionRef.current) return;
    if (isConnected || transport) return;
    if (connectPromiseRef.current) return connectPromiseRef.current;

    setConnectionStatus('connecting');
    setConnectionError(null);

    connectPromiseRef.current = (async () => {
      try {
        await refreshCurrentLocation();
        const connectedTransport = await sessionRef.current!.connectWebRTC();
        setTransport(connectedTransport);
        setIsConnected(true);
        setConnectionStatus('connected');
      } catch (error) {
        setConnectionStatus('error');
        setConnectionError(
          error instanceof Error ? error.message : '음성 연결에 실패했습니다.',
        );
        throw error;
      }
    })().finally(() => {
      connectPromiseRef.current = null;
    });

    return connectPromiseRef.current;
  };

  return (
    <RealtimeContext.Provider
      value={{ session: sessionRef.current, transport, isConnected, connectionStatus, connectionError, connect }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime은 RealtimeProvider 내부에서만 사용할 수 있습니다.');
  }
  return context;
}