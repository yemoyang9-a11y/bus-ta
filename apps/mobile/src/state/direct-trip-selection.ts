import type { CreateTripRequest, CreateTripResponse, Route } from '@bus-ta/shared';
import type { AppAction, AppTripState } from '../realtime/types';

// Scope to the stored search and cancellation generation, shared by voice and touch.
const selections = new WeakMap<object, Map<number, { route: Route; promise: Promise<CreateTripResponse> }>>();
export function startDirectTrip(deps: {
  getState: () => AppTripState;
  dispatch: (action: AppAction) => void;
  route: Route;
  request: CreateTripRequest;
  create: (request: CreateTripRequest) => Promise<CreateTripResponse>;
  stopScan: () => Promise<unknown>;
}): Promise<CreateTripResponse> {
  const state = deps.getState();
  const candidates = state.routeCandidates;
  const generation = state.directSelectionGeneration ?? 0;
  if (state.tripId || state.journeyRoute) return Promise.reject(Error('진행 중인 운행이 있습니다.'));
  if (!candidates?.includes(deps.route) || !state.routeCandidatesExpiresAt || Date.now() > state.routeCandidatesExpiresAt) {
    return Promise.reject(Error('경로 후보가 만료되었습니다. 다시 검색해 주세요.'));
  }
  let entries = selections.get(candidates);
  if (!entries) { entries = new Map(); selections.set(candidates, entries); }
  const existing = entries.get(generation);
  if (existing) return existing.route === deps.route ? existing.promise
    : Promise.reject(Object.assign(Error('다른 노선의 운행을 준비하고 있습니다.'), { code: 'SELECTION_IN_PROGRESS' }));
  const current = () => {
    const latest = deps.getState();
    return latest.routeCandidates === candidates && (latest.directSelectionGeneration ?? 0) === generation &&
      !latest.tripId && !latest.journeyRoute;
  };
  const promise = Promise.resolve().then(async () => {
    if (state.beaconScanActive) {
      // 연결이 끊긴 지팡이는 스캔을 계속할 수 없으므로 멈춘 것으로 보고 진행한다.
      // 연결된 채 중지가 실패하면 진동이 남을 수 있어 선택을 거절한다.
      await deps.stopScan().catch((error: unknown) => {
        if (!(error instanceof Error && error.message.startsWith('BLE_NOT_CONNECTED'))) throw error;
      });
      if (!current()) throw Error('운행 선택 상태가 변경되었습니다.');
      deps.dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: false });
    }
    if (!current()) throw Error('운행 선택 상태가 변경되었습니다.');
    const result = await deps.create(deps.request);
    if (result.success !== true || typeof result.tripId !== 'string' || !result.tripId.trim()) {
      throw Error('유효한 운행 생성 결과를 받지 못했습니다.');
    }
    if (!current()) throw Error('운행 선택 상태가 변경되어 이전 응답을 적용하지 않았습니다.');
    deps.dispatch({ type: 'SELECT_ROUTE', route: deps.route });
    deps.dispatch({ type: 'START_TRIP', tripId: result.tripId });
    return result;
  }).catch(error => { entries!.delete(generation); throw error; });
  // Keep success until cancellation changes the generation, including React commit delay.
  entries.clear();
  entries.set(generation, { route: deps.route, promise });
  return promise;
}
