import { sendStopRequestWithReconnect, type BellCommandDeps } from './bell-command-sender';

// 전송 성공 후에만 시작하는 Notify 대기 시간.
export const BELL_RESULT_TIMEOUT_MS = 10000;
export type BellStopResult = { outcome: 'success' | 'fail'; sendFailed: boolean };
type SessionDeps = Omit<BellCommandDeps, 'subscribeResult'> & {
  subscribeResult: (callback: (result: { result: string }) => void) => () => void;
};

/** 화면/운행 요청 하나에 하나만 생성한다. 종료 후에도 재전송하지 않는다. */
export function createBellStopSession(deps: SessionDeps) {
  const abort = new AbortController();
  let started = false;
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
        subscribeResult: (isCurrent) => deps.subscribeResult((value) => {
          if (!isCurrent?.()) return;
          finish({ outcome: value.result === 'SUCCESS' ? 'success' : 'fail', sendFailed: false });
        }),
      }, { signal: abort.signal }).then((sent) => {
        if (finished) {
          sent.unsubscribe();
          return;
        }
        unsubscribe = sent.unsubscribe;
        if (!sent.sent) {
          finish({ outcome: 'fail', sendFailed: true });
          return;
        }
        timer = setTimeout(() => finish({ outcome: 'fail', sendFailed: false }), BELL_RESULT_TIMEOUT_MS);
      });
      return result;
    },
    cancel() {
      finish({ outcome: 'fail', sendFailed: true });
    },
  };
}
