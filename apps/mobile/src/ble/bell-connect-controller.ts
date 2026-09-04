/**
 * 하차벨(버스 비콘 겸용) 보드 연결을 제한된 횟수만큼 재시도한다.
 *
 * 왜 따로 필요한가.
 *
 * 원래는 운행을 만드는 시점에 connectAll() 이 지팡이와 하차벨을 한 번에 찾았다.
 * 그런데 그 시점의 사용자는 정류장에서 버스를 기다리는 중이고, 하차벨 보드는
 * 아직 오지 않은 버스 안에 있다. BLE 범위 밖이라 10초 스캔은 반드시 실패한다.
 * 실패한 뒤에는 다시 찾는 코드가 어디에도 없어서, 정작 버스에 타고 나면 하차벨이
 * 영영 붙지 않았다. 2026-09-04 실차 시험에서 두 번 다 이렇게 실패했다.
 *
 * 그래서 하차벨 연결은 "버스 안에 있는 것이 확실한 시점" 즉 탑승 확정 뒤로 옮긴다.
 * 그때도 한 번의 스캔은 흔들리는 버스 안에서 실패할 수 있으므로 몇 번 더 시도하고,
 * 끝까지 안 되면 조용히 넘어가지 않고 사용자에게 알린다. 하차벨이 안 붙는다는 것은
 * "내릴 때 기사님께 직접 말씀드려야 한다"는 뜻이라, 모르고 있으면 못 내린다.
 */
export type BellConnectDeps = {
  /**
   * 하차벨 보드를 연결한다. 찾지 못하면 null 을 돌려주고, 오류면 reject 한다.
   * (bleManager 의 연결은 실패를 null 로 돌려주므로 둘 다 실패로 본다.)
   */
  connectBell: () => Promise<unknown>;
  /**
   * 지금도 이 운행에서 하차벨이 필요한지. 운행이 바뀌었거나 끝났으면 false.
   * 매 시도 직전과 성공 직후에 물어, 끝난 운행에 늦게 붙는 것을 막는다.
   */
  isStillWanted: () => boolean;
  /** 연결에 성공했고 아직 유효할 때. */
  onConnected: () => void;
  /**
   * 늦게 성공했는데 이미 이 운행에서 필요하지 않을 때. 연결을 끊어 되돌린다.
   * 끝날 때까지 기다린다. 던져두면 다음 운행에 남은 연결이 끼어든다.
   */
  onConnectedTooLate: () => Promise<void> | void;
  /** 상한까지 모두 실패했을 때. 사용자에게 알릴 기회를 준다. */
  onGaveUp: () => void;
  /** 재시도 전 대기. 테스트에서 즉시 진행시키려고 주입받는다. */
  wait: (ms: number) => Promise<void>;
};

/**
 * 최초 1회 + 재시도 2회.
 *
 * 한 번의 시도가 최대 10초(스캔 제한 시간)이고 각 실패 후 대기가 2초이므로,
 * 최악의 경우 약 34초 안에 끝난다. 가장 짧은 시연 구간(정류장 4개)보다 짧아서
 * 하차 판단 전에 결론이 난다.
 */
export const MAX_BELL_CONNECT_ATTEMPTS = 3;

/** 재시도 간격(ms). 각 연결 실패 후 2초. */
export const BELL_CONNECT_RETRY_DELAYS_MS = [2000, 2000];

/**
 * 하차벨 연결 해제를 제한된 횟수만큼 재시도한다.
 *
 * 예모님 지적(2026-09-04): 늦게 성공한 연결을 되돌릴 때 한 번 실패하면 로그만 남기고
 * 끝났다. 그러면 끝난 운행의 연결이 다음 운행까지 남는다. 앞 PR 의 "늦은 START 정리
 * 실패"와 같은 종류의 구멍이다.
 */
export async function disconnectBellWithRetry(deps: {
  disconnectBell: () => Promise<void>;
  onGaveUp: (error: unknown) => void;
  wait: (ms: number) => Promise<void>;
}): Promise<void> {
  for (let attempt = 0; attempt < MAX_BELL_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await deps.disconnectBell();
      return;
    } catch (error) {
      const isLastAttempt = attempt === MAX_BELL_CONNECT_ATTEMPTS - 1;
      if (isLastAttempt) {
        deps.onGaveUp(error);
        return;
      }

      await deps.wait(BELL_CONNECT_RETRY_DELAYS_MS[attempt] ?? 2000);
    }
  }
}

export async function connectBellWithRetry(
  deps: BellConnectDeps,
): Promise<void> {
  console.log('[BLE] 하차벨 연결 시작');

  for (let attempt = 0; attempt < MAX_BELL_CONNECT_ATTEMPTS; attempt += 1) {
    if (!deps.isStillWanted()) {
      console.log('[BLE] 하차벨 연결 중단 - 더 이상 현재 운행에서 필요하지 않음');
      return;
    }

    console.log(
      `[BLE] 하차벨 연결 시도 ${attempt + 1}/${MAX_BELL_CONNECT_ATTEMPTS}`,
    );

    let connected: unknown = null;

    try {
      connected = await deps.connectBell();
    } catch (error) {
      console.log(
        `[BLE] 하차벨 연결 오류 ${attempt + 1}/${MAX_BELL_CONNECT_ATTEMPTS}:`,
        error,
      );
      connected = null;
    }

    if (connected) {
      console.log(
        `[BLE] 하차벨 연결 성공 ${attempt + 1}/${MAX_BELL_CONNECT_ATTEMPTS}`,
      );

      // 연결됐다. 다만 스캔이 도는 동안 운행이 끝났을 수 있으므로 다시 묻는다.
      if (deps.isStillWanted()) {
        deps.onConnected();
      } else {
        console.log(
          '[BLE] 하차벨 연결은 성공했지만 운행이 이미 끝남 - 연결 정리 시작',
        );
        await deps.onConnectedTooLate();
      }

      return;
    }

    console.log(
      `[BLE] 하차벨 연결 실패 ${attempt + 1}/${MAX_BELL_CONNECT_ATTEMPTS}`,
    );

    const isLastAttempt = attempt === MAX_BELL_CONNECT_ATTEMPTS - 1;

    if (isLastAttempt) {
      // 상한까지 실패했다. 조용히 끝내면 사용자는 내릴 때가 되어서야 하차벨이
      // 안 눌린다는 것을 알게 된다.
      console.log('[BLE] 하차벨 연결 최종 실패');

      if (deps.isStillWanted()) {
        deps.onGaveUp();
      }

      return;
    }

    console.log('[BLE] 하차벨 연결 재시도 전 2초 대기');

    await deps.wait(BELL_CONNECT_RETRY_DELAYS_MS[attempt] ?? 2000);
  }
}
