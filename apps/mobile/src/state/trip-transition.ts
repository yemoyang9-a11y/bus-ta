import { logVoiceRouteDiagnostic } from '../realtime/voice-route-diagnostic';

type SearchState = {
  destination: unknown;
  routeCandidates: unknown;
  visibleRouteCandidates?: unknown[] | null;
  routeCandidatesExpiresAt: unknown;
  announcedCandidateIds: unknown;
  beaconScanActive: unknown;
};

type SelectionState = { tripId: string | null; routeCandidates: unknown[] | null; directSelectionGeneration?: number; journeyRoute?: unknown };
const selectionWaiters = new Set<{ candidates: unknown[] | null; generation: number; finish: (ready: boolean) => void }>();
const searchWaiters = new Set<{ candidates: unknown[]; requestId: number; finish: (ready: boolean) => void }>();

export function waitForSearchState(candidates: unknown[], requestId: number): Promise<boolean> {
  return new Promise(resolve => {
    const waiter = { candidates, requestId, finish: (ready: boolean) => {
      clearTimeout(timer); searchWaiters.delete(waiter); resolve(ready);
    } };
    const timer = setTimeout(() => waiter.finish(false), 5000);
    searchWaiters.add(waiter);
  });
}

export function confirmSearchState(state: { routeCandidates: unknown[] | null; routeSearchRequestId?: number | null }) {
  for (const waiter of searchWaiters) {
    if (state.routeSearchRequestId !== waiter.requestId) waiter.finish(false);
    else if (state.routeCandidates === waiter.candidates) waiter.finish(true);
  }
}

// A navigation request is not proof that the destination screen has focused.
export function waitForRouteSelection(state: SelectionState, generation: number): Promise<boolean> {
  return new Promise(resolve => {
    const waiter = { candidates: state.routeCandidates, generation, finish: (ready: boolean) => {
      clearTimeout(timer); selectionWaiters.delete(waiter); resolve(ready);
    } };
    const timer = setTimeout(() => { logVoiceRouteDiagnostic('screen_timeout'); waiter.finish(false); }, 5000);
    selectionWaiters.add(waiter);
  });
}
export function confirmRouteSelectionScreen(state: SelectionState, screen?: 'RouteList' | 'Main') {
  if (state.tripId || state.journeyRoute) return;
  for (const waiter of selectionWaiters) {
    if (waiter.candidates === state.routeCandidates && waiter.generation === (state.directSelectionGeneration ?? 0)) {
      logVoiceRouteDiagnostic('screen_ready', { screen, hasTrip: false });
      waiter.finish(true);
    }
  }
}

export function resetTripKeepingSearch<T extends SearchState>(
  initialState: T,
  state: T,
): T {
  const candidates = Array.isArray(state.routeCandidates) ? state.routeCandidates : [];
  return {
    ...initialState,
    destination: state.destination,
    routeCandidates: state.routeCandidates,
    routeCandidatesExpiresAt: state.routeCandidatesExpiresAt,
    // Preserve the displayed/spoken order; never revive an expired or exhausted batch.
    visibleRouteCandidates: typeof state.routeCandidatesExpiresAt === 'number' && Date.now() <= state.routeCandidatesExpiresAt && Array.isArray(state.routeCandidates)
      ? (state.visibleRouteCandidates ?? candidates.slice(0, 2)).filter(route => candidates.includes(route)) : [],
    announcedCandidateIds:
      state.announcedCandidateIds,
    // 실제 stopBeaconScan() 성공 전까지 물리 스캔 상태를 유지한다.
    beaconScanActive: state.beaconScanActive,
  };
}

export function resetCompletedTrip<T extends SearchState>(
  initialState: T,
  state: T,
): T {
  return {
    ...initialState,
    // 정상 종료에서도 실제 stopBeaconScan() 성공 전까지 상태를 유지한다.
    beaconScanActive: state.beaconScanActive,
  };
}

export function getTripNavigationTarget(state: {
  tripId: string | null;
  routeCandidates: unknown[] | null;
}): "Riding" | "RouteList" | null {
  if (state.tripId) {
    return "Riding";
  }

  if (
    state.routeCandidates &&
    state.routeCandidates.length > 0
  ) {
    return "RouteList";
  }

  return null;
}

export function isScreenTripActive(
  activeTripId: string | null,
  screenTripId: string,
) {
  return activeTripId === screenTripId;
}
