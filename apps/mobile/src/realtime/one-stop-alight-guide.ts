import { getSafeSpeech, type NativeSpeech } from './safe-speech';

export const ONE_STOP_GUIDE_MESSAGE = '하차 정류장까지 한 정거장 남았습니다. 안전하게 내릴 준비를 해주세요.';
export const ONE_STOP_REALTIME_TIMEOUT_MS = 8000;
export const ONE_STOP_REALTIME_PLAYBACK_TIMEOUT_MS = 60000;
export const ONE_STOP_LOCAL_TIMEOUT_MS = 60000;
type Session = {
  announceOneStopGuide: (tripId: string, bellRequestId: string, timeoutMs: number) => Promise<boolean>;
  cancelOneStopGuide: (tripId: string, bellRequestId: string) => void;
  recoverOutput?: () => boolean;
};
export type GuidePlayback = 'played' | 'unavailable' | 'cancelled';

/** One flow per server bell request. Deadlines are failure paths, never proof of playback. */
export function createOneStopAlightGuide(deps: {
  tripId: string;
  bellRequestId: string;
  session?: Session | null;
  speech: NativeSpeech;
  isCurrent: () => boolean;
  localTimeoutMs?: number;
}) {
  let cancelled = false;
  let localActive = false;
  let settleLocal: ((result: GuidePlayback) => void) | undefined;
  let result: Promise<GuidePlayback> | undefined;
  const speech = getSafeSpeech(deps.speech);
  const stopLocal = () => {
    if (!localActive) return speech.waitUntilSafe();
    localActive = false;
    return speech.stop();
  };
  const current = () => !cancelled && deps.isCurrent();
  return {
    start(): Promise<GuidePlayback> {
      return result ??= (async () => {
        if (!speech.canSpeak() && !await speech.waitUntilSafe()) {
          return current() ? 'unavailable' : 'cancelled';
        }
        if (!current()) return 'cancelled';
        let played = false;
        try { played = await deps.session?.announceOneStopGuide(deps.tripId, deps.bellRequestId, ONE_STOP_REALTIME_TIMEOUT_MS) ?? false; }
        catch (error) {
          if (error instanceof Error && error.message === 'GUIDE_AUDIO_CLEANUP_FAILED') {
            speech.blockExternal(() => deps.session?.recoverOutput?.() ?? false);
            return current() ? 'unavailable' : 'cancelled';
          }
          // No output was established; use local speech.
        }
        if (!current()) return 'cancelled';
        if (played) return 'played';
        return new Promise<GuidePlayback>(resolve => {
          let settled = false;
          const finish = (value: GuidePlayback, needsStop = false) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            settleLocal = undefined;
            const cleanup = needsStop ? stopLocal() : Promise.resolve(true);
            localActive = false;
            void cleanup.then(() => resolve(current() ? value : 'cancelled'));
          };
          const timer = setTimeout(() => {
            finish('unavailable', true);
          }, deps.localTimeoutMs ?? ONE_STOP_LOCAL_TIMEOUT_MS);
          settleLocal = finish;
          localActive = true;
          try {
            speech.speak(ONE_STOP_GUIDE_MESSAGE, {
              language: 'ko', onDone: () => finish('played'),
              onStopped: () => finish('unavailable'), onError: () => finish('unavailable', true),
            });
          } catch { finish('unavailable', true); }
        });
      })();
    },
    canSpeak: speech.canSpeak,
    cancel(stopSpeech = true) {
      cancelled = true;
      deps.session?.cancelOneStopGuide(deps.tripId, deps.bellRequestId);
      if (stopSpeech) stopLocal();
      settleLocal?.('cancelled');
    },
  };
}
