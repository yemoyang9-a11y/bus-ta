/**
 * 하차벨에 STOP_REQUEST 를 보낸다. 필요하면 다시 연결하고 한 번 더 보낸다.
 *
 * 예모님 지적(2026-09-04):
 *
 * 하나. 연결 확인이 Map 조회였다. 버스 안에서 BLE 가 끊겨도 Map 에는 기기가 남아
 * 있어 "연결됨"으로 보였고, 재연결을 건너뛴 채 명령을 보내다 실패했다. 그래서
 * 여기서는 실제 장치에 물어보는 isConnected 를 주입받는다.
 *
 * 둘. 명령 전송이 던져두기(`sendStopRequest().catch(log)`)였다. GATT write 는 버스
 * 진동이나 순간적인 간섭으로 한 번 실패할 수 있는데, 실패해도 10초 타임아웃을
 * 그대로 기다렸다가 실패로 확정했다. 연결 시점을 고쳐도 이 구간에서 벨이 안 울린다.
 *
 * 재시도는 딱 한 번이다. 연결 확인부터 write까지 전체 5초 예산을 적용하고,
 * 전송 성공 이후의 하차벨 결과 대기 시간(10초)은 별도로 관리한다.
 */
export type BellCommandDeps = {
  /** 실제 장치에 물어본 연결 여부. Map 조회가 아니어야 한다. */
  isConnected: () => Promise<boolean>;
  /** 하차벨을 연결한다. 실패하면 null 을 돌려주거나 reject 한다. */
  connect: () => Promise<unknown>;
  /**
   * 결과(Notify)를 구독한다. 연결이 없으면 throw 한다.
   * 재전송 전에는 반드시 이전 구독을 해제하고 다시 구독한다. 연결이 새로 맺어지면
   * 이전 구독은 죽은 연결에 붙어 있어 결과가 오지 않는다.
   */
  subscribeResult: (isCurrent?: () => boolean) => () => void;
  /** STOP_REQUEST 를 보낸다. 실패하면 reject 한다. */
  sendStopRequest: () => Promise<void>;
};

export type BellCommandOutcome = {
  /** 명령을 실제로 보냈는지. false 면 결과를 기다릴 필요 없이 실패로 확정한다. */
  sent: boolean;
  /** 결과 구독 해제. 보내지 못했으면 아무것도 하지 않는 함수다. */
  unsubscribe: () => void;
};

const noop = () => undefined;

async function ensureConnected(deps: BellCommandDeps): Promise<boolean> {
  let connected = false;

  try {
    connected = await deps.isConnected();
  } catch (error) {
    console.log('[BLE] 하차벨 실제 연결 상태 확인 실패:', error);
  }

  console.log('[BLE] 하차벨 실제 연결 상태:', connected);

  if (connected) return true;

  console.log('[BLE] 하차벨 미연결 - 재연결 시작');

  try {
    await deps.connect();
  } catch (error) {
    console.log('[BLE] 하차벨 재연결 오류:', error);
    return false;
  }

  try {
    connected = await deps.isConnected();
  } catch (error) {
    console.log('[BLE] 하차벨 재연결 후 상태 확인 실패:', error);
    return false;
  }

  console.log('[BLE] 하차벨 재연결 결과:', connected);

  return connected;
}

async function sendWithReconnect(
  deps: BellCommandDeps,
): Promise<BellCommandOutcome> {
  console.log('[BLE] STOP_REQUEST 처리 시작');

  if (!(await ensureConnected(deps))) {
    console.log('[BLE] 하차벨 연결 실패 - STOP_REQUEST 전송하지 않음');
    return { sent: false, unsubscribe: noop };
  }

  let unsubscribe: () => void;

  try {
    unsubscribe = deps.subscribeResult();
    console.log('[BLE] 하차벨 결과 Notify 구독 완료');
  } catch (error) {
    console.log('[BLE] 하차벨 결과 Notify 구독 실패:', error);
    return { sent: false, unsubscribe: noop };
  }

  try {
    console.log('[BLE] STOP_REQUEST 전송 1/2');
    await deps.sendStopRequest();
    console.log('[BLE] STOP_REQUEST 전송 성공 1/2');

    return { sent: true, unsubscribe };
  } catch (error) {
    console.log(
      '[BLE] STOP_REQUEST 전송 실패 1/2 - 재연결 후 1회 재시도:',
      error,
    );

    unsubscribe();
  }

  if (!(await ensureConnected(deps))) {
    console.log(
      '[BLE] STOP_REQUEST 재시도 전 하차벨 연결 복구 실패 - 전송 중단',
    );
    return { sent: false, unsubscribe: noop };
  }

  let retryUnsubscribe: () => void;

  try {
    retryUnsubscribe = deps.subscribeResult();
    console.log('[BLE] STOP_REQUEST 재시도용 Notify 구독 완료');
  } catch (error) {
    console.log('[BLE] STOP_REQUEST 재시도용 Notify 구독 실패:', error);
    return { sent: false, unsubscribe: noop };
  }

  try {
    console.log('[BLE] STOP_REQUEST 재전송 2/2');
    await deps.sendStopRequest();
    console.log('[BLE] STOP_REQUEST 재전송 성공 2/2');

    return {
      sent: true,
      unsubscribe: retryUnsubscribe,
    };
  } catch (error) {
    console.log(
      '[BLE] STOP_REQUEST 재전송 최종 실패 - 추가 재전송하지 않음:',
      error,
    );

    retryUnsubscribe();

    return {
      sent: false,
      unsubscribe: noop,
    };
  }
}

// Notify 결과 대기 시간과 별개인 연결 확인/복구/write 전체 예산.
export const BELL_SEND_DEADLINE_MS = 5000;

export async function sendStopRequestWithReconnect(
  deps: BellCommandDeps,
  options: { signal?: AbortSignal } = {},
): Promise<BellCommandOutcome> {
  let active = true;
  let sentSuccessfully = false;
  let writeStarted = false;
  let subscription: () => void = noop;
  const expiresAt = Date.now() + BELL_SEND_DEADLINE_MS;
  const cleanup = () => {
    const remove = subscription;
    subscription = noop;
    remove();
  };
  const check = () => {
    if (!active || options.signal?.aborted || Date.now() >= expiresAt) {
      throw new Error('BELL_SEND_CANCELLED_OR_TIMED_OUT');
    }
  };
  let stop: () => void = noop;
  const stopped = new Promise<BellCommandOutcome>((resolve) => {
    stop = () => {
      active = false;
      cleanup();
      resolve({ sent: false, unsubscribe: noop });
    };
  });
  const timer = setTimeout(stop, BELL_SEND_DEADLINE_MS);
  options.signal?.addEventListener('abort', stop);
  const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    const value = await operation();
    check();
    return value;
  };
  try {
    if (options.signal?.aborted) stop();
    const work = sendWithReconnect({
      isConnected: () => guarded(deps.isConnected),
      connect: () => guarded(deps.connect),
      sendStopRequest: () => {
        writeStarted = true;
        return guarded(deps.sendStopRequest);
      },
      subscribeResult: () => {
        check();
        // 각 구독은 바로 뒤에 오는 해당 attempt의 write가 시작된 뒤에만 유효하다.
        // 구독 등록 중 동기 Notify가 들어와도 이전/잔여 결과를 현재 요청 성공으로 보지 않는다.
        writeStarted = false;
        let subscribed = true;
        const remove = deps.subscribeResult(() => subscribed && writeStarted &&
          !options.signal?.aborted &&
          (sentSuccessfully || (active && Date.now() < expiresAt)));
        subscription = () => {
          subscribed = false;
          remove();
        };
        if (!active || options.signal?.aborted) cleanup();
        return cleanup;
      },
    }).catch(() => ({ sent: false, unsubscribe: noop }));
    const outcome = await Promise.race([work, stopped]);
    sentSuccessfully = outcome.sent;
    if (!outcome.sent) cleanup();
    return outcome;
  } finally {
    active = false;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
  }
}
