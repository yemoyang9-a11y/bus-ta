import { sendStopRequestWithReconnect, type BellCommandDeps } from './bell-command-sender';

// 전송 성공 후에만 시작하는 Notify 대기 시간.
export const BELL_RESULT_TIMEOUT_MS = 10000;
export type BellStopResult = { outcome: 'success' | 'fail'; sendFailed: boolean; cancelled?: boolean };
type SessionDeps = Omit<BellCommandDeps, 'subscribeResult'> & {
  canSend?: () => boolean;
  subscribeResult: (callback: (result: { result: string }) => void) => () => void;
};

/** 화면/운행 요청 하나에 하나만 생성한다. 종료 후에도 재전송하지 않는다. */
export function createBellStopSession(deps: SessionDeps) {
  const abort = new AbortController();
  let started = false;
  let writeStarted = false;
  let sendingStopped = false;
  let finished = false;
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (result: BellStopResult) => void;
  const result = new Promise<BellStopResult>((resolve) => { resolveResult = resolve; });
  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const remove = unsubscribe;
    unsubscribe = () => {};
    remove();
  };
  const finish = (value: BellStopResult) => {
    if (finished) return;
    finished = true;
    abort.abort();
    cleanup();
    resolveResult(value);
  };
  return {
    start() {
      if (started || finished) return result;
      started = true;
      void sendStopRequestWithReconnect({
        ...deps,
        sendStopRequest: () => { writeStarted = true; return deps.sendStopRequest(); },
        subscribeResult: (isCurrent) => deps.subscribeResult((value) => {
          if (!isCurrent?.()) return;
          finish({ outcome: value.result === 'SUCCESS' ? 'success' : 'fail', sendFailed: false });
        }),
      }, { signal: abort.signal, canSend: () => !sendingStopped && deps.canSend?.() !== false }).then((sent) => {
        if (finished) {
          sent.unsubscribe();
          return;
        }
        unsubscribe = sent.unsubscribe;
        if (!sent.sent) {
          const cancelled = !writeStarted && (sendingStopped || deps.canSend?.() === false);
          finish({ outcome: 'fail', sendFailed: true, ...(cancelled ? { cancelled: true } : {}) });
          return;
        }
        timer = setTimeout(() => finish({ outcome: 'fail', sendFailed: false }), BELL_RESULT_TIMEOUT_MS);
      });
      return result;
    },
    stopSending() {
      sendingStopped = true;
      // 미전송 요청은 조용히 종료한다. 전송 중/전송 후 Notify와 결과 저장은 유지한다.
      if (!writeStarted) finish({ outcome: 'fail', sendFailed: true, cancelled: true });
    },
    cancel() {
      finish({ outcome: 'fail', sendFailed: true });
    },
  };
}
