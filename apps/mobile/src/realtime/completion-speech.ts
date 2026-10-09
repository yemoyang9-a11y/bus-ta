import { TRIP_COMPLETION_MESSAGE } from './trip-tracking';
type Speech = { speak: (message: string, options: { language: string; onDone: () => void; onStopped: () => void; onError: () => void }) => unknown; stop: () => unknown };
export function speakCompletionFallback(speech: Speech, timeoutMs = 15000, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(); return; }
    let settled = false;
    const finish = () => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(() => { try { void speech.stop(); } finally { finish(); } }, timeoutMs);
    const abort = () => { try { void speech.stop(); } finally { finish(); } };
    signal?.addEventListener('abort', abort, { once: true });
    try { speech.speak(TRIP_COMPLETION_MESSAGE, { language: 'ko', onDone: finish, onStopped: finish, onError: finish }); }
    catch { finish(); }
  });
}
