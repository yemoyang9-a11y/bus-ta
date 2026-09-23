import type { AppTripState } from './types';
import type { TripStatusResponse, UpdateTripStatusRequest } from '@bus-ta/shared';

export const TRIP_COMPLETION_MESSAGE = '목적지 정류장에 도착했습니다. 안전하게 내리세요. 안내를 마칩니다.';
export function arrivalRefreshDelay(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.max(1000, value) : 15000;
}
let locationRequestSequence = 0;
type LocationSample = { timestamp: number; coords: { latitude: number; longitude: number } };
type Dependencies = {
  tripId: string;
  getState: () => Pick<AppTripState, 'tripId' | 'tripStatus' | 'boardingConfirmedAt' | 'nextArrivalRefreshInMs'>;
  requestPermission: () => Promise<string>;
  watchPosition: (onLocation: (location: LocationSample) => Promise<void>) => Promise<{ remove(): void }>;
  updateStatus: (tripId: string, body: UpdateTripStatusRequest) => Promise<TripStatusResponse>;
  getStatus: (tripId: string) => Promise<TripStatusResponse>;
  applyStatus: (status: TripStatusResponse) => void;
  announceCompletion: () => Promise<unknown>;
  finish: () => void;
  onError: (code: string) => void;
  schedule?: (callback: () => void, ms: number) => any;
  cancelTimer?: (timer: any) => void;
};

// Provider owns one controller per trip, so screen transitions never reset the GPS subscription.
export function createTripTracking(d: Dependencies) {
  const schedule = d.schedule ?? setTimeout;
  const cancelTimer = d.cancelTimer ?? clearTimeout;
  let cancelled = false, completing = false, patchInFlight = false, polling = false;
  let subscription: { remove(): void } | null = null;
  let timer: any = null;
  const current = () => !cancelled && d.getState().tripId === d.tripId && d.getState().tripStatus !== 'CANCELLED';
  const waiting = () => current() && !completing && d.getState().tripStatus === 'WAITING_BUS' && !d.getState().boardingConfirmedAt;
  const clearPoll = () => { if (timer !== null) cancelTimer(timer); timer = null; };
  const removeWatch = () => { const old = subscription; subscription = null; try { old?.remove(); } catch { /* native cleanup can already have completed */ } };
  const complete = () => {
    if (!current() || completing) return;
    completing = true;
    clearPoll(); removeWatch();
    // The completion speaker has its own finite output deadline and local speech fallback.
    void d.announceCompletion().catch(() => undefined).then(() => { if (current()) d.finish(); });
  };
  const apply = (status: TripStatusResponse) => {
    if (!current() || completing || (status.tripId && status.tripId !== d.tripId)) return;
    const previous = d.getState().tripStatus;
    if (previous === 'TRIP_DONE' && status.tripStatus !== 'TRIP_DONE') return;
    if (previous !== 'WAITING_BUS' && status.tripStatus === 'WAITING_BUS') return;
    d.applyStatus(status);
    if (status.tripStatus === 'TRIP_DONE') complete();
  };
  const queuePoll = (delay: unknown) => {
    clearPoll();
    if (waiting()) timer = schedule(() => { timer = null; void poll(); }, arrivalRefreshDelay(delay));
  };
  const poll = async () => {
    if (!waiting() || polling) return;
    polling = true;
    let delay: unknown = 15000;
    try {
      const status = await d.getStatus(d.tripId);
      if (!waiting()) return;
      delay = status.nextArrivalRefreshInMs;
      apply(status);
    } catch { if (waiting()) d.onError('ARRIVAL_REFRESH_FAILED'); }
    finally { polling = false; if (waiting()) queuePoll(delay); }
  };
  const onLocation = async (location: LocationSample) => {
    if (!current() || completing || patchInFlight || !Number.isFinite(location.timestamp) ||
      !Number.isFinite(location.coords.latitude) || !Number.isFinite(location.coords.longitude)) return;
    patchInFlight = true;
    try {
      const status = await d.updateStatus(d.tripId, {
        requestId: `location-${d.tripId}-${Date.now()}-${++locationRequestSequence}`,
        latitude: location.coords.latitude, longitude: location.coords.longitude,
        recordedAt: new Date(location.timestamp).toISOString(), source: 'GPS',
      });
      apply(status);
    } catch (error) {
      if (!current() || completing) return;
      const code = (error as { errorCode?: string })?.errorCode;
      if (code === 'INVALID_TRIP_STATUS') {
        try { apply(await d.getStatus(d.tripId)); } catch { if (current()) d.onError('STATUS_REFRESH_FAILED'); }
      } else d.onError(code === 'TRIP_NOT_FOUND' ? code : 'LOCATION_UPDATE_FAILED');
    } finally { patchInFlight = false; }
  };
  return {
    start() {
      queuePoll(d.getState().nextArrivalRefreshInMs);
      void (async () => {
        if (await d.requestPermission() !== 'granted') { if (current()) d.onError('LOCATION_PERMISSION_DENIED'); return; }
        if (!current() || completing) return;
        const created = await d.watchPosition(onLocation);
        if (!current() || completing) { created.remove(); return; }
        subscription = created;
      })().catch(() => { if (current()) d.onError('LOCATION_WATCH_FAILED'); });
    },
    sync() {
      if (!current()) { clearPoll(); removeWatch(); return; }
      if (d.getState().tripStatus === 'TRIP_DONE') complete();
      if (!waiting()) clearPoll();
    },
    stop() { cancelled = true; clearPoll(); removeWatch(); },
  };
}
