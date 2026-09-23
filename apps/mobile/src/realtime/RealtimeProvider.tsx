import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useTrip } from '../state/TripContext';
import { apiClient, ApiError } from '../api/client';
import {
  connectCane,
  disconnectBellsForTrip,
  setTargetBeacon,
  startBeaconScan,
  stopBeaconScan,
  disconnectCane,
  subscribeCaneState,
} from '../ble/bleManager';
import { createTripTracking } from './trip-tracking';
import { toTripStatusSnapshot } from './status-snapshot';
import { speakCompletionFallback } from './completion-speech';
import { createAutomaticBoarding } from './automatic-boarding';
import { releaseCane } from '../ble/cane-release-controller';
import { HaneumRealtimeSession } from './session';
import { createRealtimeGuideContext } from './context';
import { connectWithBestEffortLocation, runSingleFlight } from './connect-best-effort';
import { createLocationRefreshCoordinator } from './location-refresh';
import { createAssistDevicePreparation } from './assist-device-preparation';
import { getAssistDeviceFallbackMessage } from './assist-device-status';
import type { RealtimeWebRTCTransport } from './webrtc-transport';
import type { AppAction, AppTripState, AssistDeviceStatusChangedEvent } from './types';

export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

// RealtimeProvider가 화면에 제공하는 것
type RealtimeContextValue = {
  session: HaneumRealtimeSession | null;
  transport: RealtimeWebRTCTransport | null;
  isConnected: boolean;
  connectionStatus: RealtimeConnectionStatus;
  connectionError: string | null;
  trackingError: string | null;
  connect: () => Promise<void>;
  notifyFailure: (event: AssistDeviceStatusChangedEvent) => void;
  getActiveTripId: () => string | null;
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

  const [trackingError, setTrackingError] = useState<string | null>(null);
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
  const locationRefreshRef = useRef<ReturnType<typeof createLocationRefreshCoordinator> | null>(null);

  if (!locationRefreshRef.current) {
    locationRefreshRef.current = createLocationRefreshCoordinator({
      setLocation: (location) => {
        currentLocationRef.current = location;
      },
    });
  }

  const refreshCurrentLocation = async () => {
    await locationRefreshRef.current!({
      requestPermission: async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        return status;
      },
      getPosition: async () => {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        return {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
      },
    });
  };

  // 위치 권한이 있으면 현재 위치를 주기적으로 갱신해 둔다.
  // search_routes 등에서 모델이 지어낼 수 없는 실제 좌표로만 쓰인다.
  useEffect(() => {
    void refreshCurrentLocation().catch(() => undefined);
  }, []);

  const sessionRef = useRef<HaneumRealtimeSession | null>(null);
  if (!sessionRef.current) {
    const guideContext = createRealtimeGuideContext({
      getAppState: () => stateRef.current,
      getCurrentLocation: () => currentLocationRef.current,
      refreshCurrentLocation,
      dispatchAppAction: (action: AppAction) => dispatchRef.current(action),
    });
    sessionRef.current = new HaneumRealtimeSession(guideContext);
  }

  const assistPreparationRef = useRef<ReturnType<typeof createAssistDevicePreparation> | null>(null);
  const notifyFailure = (event: AssistDeviceStatusChangedEvent) => {
    const deliveredToRealtime =
      sessionRef.current?.notifyAssistDeviceStatusChange(event) ?? false;
    if (!deliveredToRealtime) {
      Speech.speak(getAssistDeviceFallbackMessage(event), { language: 'ko' });
    }
  };
  const getActiveTripId = () => stateRef.current.tripStatus === 'CANCELLED' ? null : stateRef.current.tripId;

  // Provider는 Riding → Alight 이동에도 유지된다. 실제 운행 변경에만 GATT를 정리한다.
  const activeBellTripId = getActiveTripId();
  useEffect(() => {
    const ownerTripId = activeBellTripId;
    return () => {
      if (ownerTripId) void disconnectBellsForTrip(ownerTripId);
    };
  }, [activeBellTripId]);

  if (!assistPreparationRef.current) {
    assistPreparationRef.current = createAssistDevicePreparation({
      getActiveTripId,
      isWaitingForBus: () => stateRef.current.tripStatus === 'WAITING_BUS' && !stateRef.current.boardingConfirmedAt,
      releaseCane: () => releaseCane({
        stop: stopBeaconScan, disconnect: disconnectCane,
        onStopped: () => dispatchRef.current({ type: 'SET_BEACON_SCAN_ACTIVE', active: false }),
      }),
      listBeacons: (routeNo) => apiClient.beacons.list(routeNo),
      getBeaconLookupErrorCode: (error) =>
        error instanceof ApiError ? error.errorCode : undefined,
      connectCane,
      setTargetBeacon,
      startBeaconScan,
      notifyFailure,
      dispatch: (action) => dispatchRef.current(action),
    });
  }

  useEffect(() => {
    const tripId = state.tripId;
    const routeNo = state.selectedRoute?.routeNo;
    if (!tripId || !routeNo) return;

    void assistPreparationRef.current?.prepare({
      tripId,
      routeNo,
    });
    return () => { void assistPreparationRef.current?.release(tripId); };
  }, [state.tripId, state.selectedRoute?.routeNo]);

  useEffect(() => {
    if (state.tripId && (state.boardingConfirmedAt || state.tripStatus === 'CANCELLED')) {
      void assistPreparationRef.current?.release(state.tripId);
    }
  }, [state.tripId, state.boardingConfirmedAt, state.tripStatus]);

  useEffect(() => {
    if (!state.tripId || state.tripStatus !== 'WAITING_BUS' || !state.caneReady || !state.beaconScanActive || !state.targetBeaconId) return;
    const tripId = state.tripId;
    const automatic = createAutomaticBoarding({
      tripId, targetBeaconId: state.targetBeaconId,
      getState: () => stateRef.current,
      subscribe: subscribeCaneState,
      confirm: (id, body) => apiClient.trips.confirmBoarding(id, body),
      apply: (result) => {
        dispatchRef.current({ type: 'CONFIRM_BOARDING', tripId, tripStatus: result.tripStatus, boardingMethod: result.boardingMethod, boardingConfirmedAt: result.boardingConfirmedAt });
        sessionRef.current?.notifyStatusChange(toTripStatusSnapshot({ ...stateRef.current, ...result }));
      },
      onFailure: () => {
        if (stateRef.current.tripId === tripId && stateRef.current.tripStatus === 'WAITING_BUS') {
          Speech.speak('자동 탑승 확인을 마치지 못했습니다. 버스에 타셨다면 음성으로 탑승했다고 말씀해 주세요.', { language: 'ko' });
        }
      },
    });
    automatic.start();
    return () => automatic.stop();
  }, [state.tripId, state.tripStatus, state.targetBeaconId, state.caneReady, state.beaconScanActive]);

  const trackingRef = useRef<ReturnType<typeof createTripTracking> | null>(null);
  useEffect(() => {
    const tripId = state.tripId;
    if (!tripId) return;
    setTrackingError(null);
    const completionAbort = new AbortController();
    const controller = createTripTracking({
      tripId, getState: () => stateRef.current,
      requestPermission: async () => (await Location.requestForegroundPermissionsAsync()).status,
      watchPosition: callback => Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 0 }, callback),
      updateStatus: (id, body) => apiClient.trips.updateStatus(id, body),
      getStatus: id => apiClient.trips.getStatus(id),
      applyStatus: status => {
        dispatchRef.current({ type: 'UPDATE_TRIP_STATUS', status });
        if (status.tripStatus === 'CANCELLED') dispatchRef.current({ type: 'RESET_TRIP_KEEP_SEARCH' });
        else sessionRef.current?.notifyStatusChange(toTripStatusSnapshot(status));
      },
      announceCompletion: async () => {
        const played = await sessionRef.current?.announceTripCompletion(tripId);
        if (!played && stateRef.current.tripId === tripId) await speakCompletionFallback(Speech, 15000, completionAbort.signal);
      },
      finish: () => {
        if (stateRef.current.tripId === tripId) dispatchRef.current({ type: 'RESET_TRIP' });
      },
      onError: code => {
        // Transient network refresh failures keep tracking; never print raw location/error objects.
        if (code === 'LOCATION_PERMISSION_DENIED' || code === 'LOCATION_WATCH_FAILED' || code === 'TRIP_NOT_FOUND') {
          controller.stop();
          if (code === 'TRIP_NOT_FOUND') dispatchRef.current({ type: 'RESET_TRIP' });
          setTrackingError(code);
        }
      },
    });
    trackingRef.current = controller;
    controller.start();
    return () => { controller.stop(); completionAbort.abort(); sessionRef.current?.cancelTripCompletion(tripId); if (trackingRef.current === controller) trackingRef.current = null; };
  }, [state.tripId]);
  useEffect(() => { trackingRef.current?.sync(); }, [state.tripId, state.tripStatus, state.boardingConfirmedAt]);

  const connect = () => {
    if (!sessionRef.current) return Promise.resolve();
    if (isConnected || transport) return Promise.resolve();

    setConnectionStatus('connecting');
    setConnectionError(null);

    return runSingleFlight(connectPromiseRef, async () => {
      try {
        const connectedTransport = await connectWithBestEffortLocation({
          refreshCurrentLocation,
          connectWebRTC: () => sessionRef.current!.connectWebRTC(),
        });
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
    });
  };

  return (
    <RealtimeContext.Provider
      value={{
        session: sessionRef.current,
        transport,
        isConnected,
        connectionStatus,
        connectionError,
        trackingError,
        connect,
        notifyFailure,
        getActiveTripId,
      }}
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
