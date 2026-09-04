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
 * 재시도는 딱 한 번이다. 사용자는 곧 내려야 하고, 하차벨 결과 대기 시간(10초)
 * 안에 결론이 나야 한다.
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
  subscribeResult: () => () => void;
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
  if (await deps.isConnected()) return true;

  try {
    await deps.connect();
  } catch {
    return false;
  }

  return deps.isConnected();
}

export async function sendStopRequestWithReconnect(
  deps: BellCommandDeps,
): Promise<BellCommandOutcome> {
  if (!(await ensureConnected(deps))) {
    return { sent: false, unsubscribe: noop };
  }

  let unsubscribe: () => void;
  try {
    unsubscribe = deps.subscribeResult();
  } catch {
    return { sent: false, unsubscribe: noop };
  }

  try {
    await deps.sendStopRequest();
    return { sent: true, unsubscribe };
  } catch {
    // 첫 전송이 실패했다. 연결이 끊겨서일 수 있으므로 확인하고 다시 붙은 뒤 한 번 더.
    unsubscribe();
  }

  if (!(await ensureConnected(deps))) {
    return { sent: false, unsubscribe: noop };
  }

  let retryUnsubscribe: () => void;
  try {
    retryUnsubscribe = deps.subscribeResult();
  } catch {
    return { sent: false, unsubscribe: noop };
  }

  try {
    await deps.sendStopRequest();
    return { sent: true, unsubscribe: retryUnsubscribe };
  } catch {
    retryUnsubscribe();
    return { sent: false, unsubscribe: noop };
  }
}
