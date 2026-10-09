import type { SafeSpeech } from './safe-speech';

/** One explicit attempt; no background retry loop or dependency on navigation/BLE. */
export function createVoiceRecovery<T>(deps: {
  speech: SafeSpeech;
  getContext: () => string;
  repairOutput: () => boolean;
  connect: (signal: AbortSignal, recovery: boolean) => Promise<T>;
  publish: (transport: T, recovery: boolean) => void;
  discard: (transport: T) => void;
  onStatus: (status: 'connecting' | 'connected' | 'error' | 'idle', error?: string) => void;
  onAudioRecovered?: () => void;
}) {
  let pending: Promise<boolean> | null = null;
  let controller: AbortController | null = null;
  return {
    run(signal?: AbortSignal, repairAudio = true): Promise<boolean> {
      if (pending) return pending;
      const context = deps.getContext();
      const request = new AbortController();
      controller = request;
      const abort = () => request.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) request.abort();
      const current = () => !request.signal.aborted && deps.getContext() === context;
      const releaseAudio = repairAudio ? deps.speech.hold() : () => {};
      deps.onStatus('connecting');
      const task = Promise.resolve().then(async () => {
        try {
          if (!current()) return false;
          if (repairAudio || deps.speech.isUnsafe()) {
            if (!deps.repairOutput()) throw Error('이전 음성을 종료하지 못했습니다. 다시 시도해 주세요.');
            deps.speech.clearExternalBlock();
            if (!await deps.speech.recover()) throw Error('음성 중지를 확인하지 못했습니다. 다시 시도해 주세요.');
          }
          if (!current()) return false;
          if (repairAudio) deps.onAudioRecovered?.();
          const transport = await deps.connect(request.signal, repairAudio);
          if (!current()) { deps.discard(transport); return false; }
          if (deps.speech.isUnsafe()) {
            deps.discard(transport);
            throw Error('음성 정리를 확인하지 못했습니다. 다시 시도해 주세요.');
          }
          try { deps.publish(transport, repairAudio); }
          catch (error) { deps.discard(transport); throw error; }
          deps.onStatus('connected');
          return true;
        } catch (error) {
          if (current()) deps.onStatus('error', error instanceof Error ? error.message : '음성 연결에 실패했습니다.');
          return false;
        } finally {
          releaseAudio();
          if (!current()) deps.onStatus('idle');
          signal?.removeEventListener('abort', abort);
          if (controller === request) controller = null;
          if (pending === task) pending = null;
        }
      });
      pending = task;
      return task;
    },
    cancel() { controller?.abort(); },
    isRunning: () => Boolean(pending),
  };
}
