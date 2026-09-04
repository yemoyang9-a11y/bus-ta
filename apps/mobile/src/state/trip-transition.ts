type SearchState = {
  destination: unknown;
  routeCandidates: unknown;
  routeCandidatesExpiresAt: unknown;
  announcedCandidateIds: unknown;
  beaconScanActive: unknown;
};

export function resetTripKeepingSearch<T extends SearchState>(
  initialState: T,
  state: T,
): T {
  return {
    ...initialState,
    destination: state.destination,
    routeCandidates: state.routeCandidates,
    routeCandidatesExpiresAt: state.routeCandidatesExpiresAt,
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
