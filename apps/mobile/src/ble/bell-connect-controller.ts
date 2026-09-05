/**
 * 하차벨(버스 비콘 겸용) 보드 연결을 제한된 횟수만큼 재시도한다.
 *
 * 왜 따로 필요한가.
 *
 * 원래는 운행을 만드는 시점에 connectAll() 이 지팡이와 하차벨을 한 번에 찾았다.
 * 그런데 그 시점의 사용자는 정류장에서 버스를 기다리는 중이고, 하차벨 보드는
 * 아직 오지 않은 버스 안에 있다. BLE 범위 밖이라 연결이 실패한다.
 * 실패한 뒤에는 다시 찾는 코드가 없어, 정작 버스에 타고 나서도 하차벨이
 * 연결되지 않았다. 2026-09-04 실차 시험에서 두 번 다 이렇게 실패했다.
 *
 * 그래서 하차벨 연결은 "버스 안에 있는 것이 확실한 시점"인 탑승 확정 뒤에 시작한다.
 *
 * P0 수정(2026-09-05):
 * - 연결 재시도 루프가 하차 판정보다 오래 살아 있지 않도록 시도 횟수를 제한한다.
 * - 운행이 더 이상 유효하지 않아 중단할 때 조용히 return 하지 않고
 *   onCancelled()을 호출해 호출자가 중단 사실을 명시적으로 처리할 수 있게 한다.
 * - 하차 화면으로 이동했다는 이유만으로 연결을 취소하지 않는다.
 *   "이 운행이 아직 현재 운행인가"의 판단은 호출자가 isStillWanted로 제공한다.
 */
export type BellConnectDeps = {
  /**
   * 하차벨 보드를 연결한다.
   * 찾지 못하면 null 을 돌려주고, 오류면 reject 한다.
   */
  connectBell: () => Promise<unknown>;

  /**
   * 이 연결 시도를 시작한 운행이 아직 현재 운행인지 확인한다.
   *
   * GPS watch가 멈췄는지, RidingScreen이 하차 화면으로 이동했는지 같은
   * 화면 생명주기와 섞으면 안 된다. 운행이 실제로 취소되거나 다른 운행으로
   * 교체된 경우에만 false가 되어야 한다.
   */
  isStillWanted: () => boolean;

  /** 연결에 성공했고 아직 같은 운행일 때. */
  onConnected: () => void;

  /**
   * BLE 연결은 성공했지만 기다리는 사이 운행이 취소/교체된 경우.
   * 이전 운행의 연결이 다음 운행에 남지 않도록 실제 연결을 해제한다.
   */
  onConnectedTooLate: () => Promise<void> | void;

  /**
   * 허용된 연결 시도를 모두 사용했지만 연결하지 못한 경우.
   * 호출자는 bellConnected=false 확정 및 사용자 안내를 수행한다.
   */
  onGaveUp: () => void;

  /**
   * 재시도 도중 운행 자체가 취소되거나 다른 운행으로 교체된 경우.
   *
   * 이전 구현은 이 경우 그냥 return 해서 연결 루프가 왜 끝났는지 아무 흔적도
   * 남기지 않았다. 호출자가 이전 운행과 현재 운행을 구분해 안전하게 정리할 수
   * 있도록 중단을 명시적인 결과로 전달한다.
   */
  onCancelled: () => void;

  /** 재시도 전 대기. 테스트에서는 즉시 진행시키기 위해 주입받는다. */
  wait: (ms: number) => Promise<void>;
};

/**
 * 최초 1회 + 재시도 1회.
 *
 * 기존에는 3회였지만 BLE 한 번의 시도가 스캔과 연결/서비스 탐색을 포함해
 * 예상보다 오래 지속될 수 있어 전체 루프가 시연의 하차 판정보다 늦게 끝났다.
 *
 * 실제 한 번의 BLE 시도 시간도 bleManager에서 별도로 제한한다.
 * 두 계층을 함께 제한해 하차 판정 전에 연결 성공/실패가 확정되도록 한다.
 */
export const MAX_BELL_CONNECT_ATTEMPTS = 2;

/** 첫 실패 후 한 번만 2초 대기한다. */
export const BELL_CONNECT_RETRY_DELAYS_MS = [2000];

/**
 * 하차벨 연결 해제를 제한된 횟수만큼 재시도한다.
 *
 * 늦게 성공한 이전 운행의 연결을 되돌릴 때 한 번의 해제 실패만으로 끝내면
 * 이전 버스 연결이 다음 운행까지 남을 수 있으므로 제한된 횟수만큼 재시도한다.
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
      const isLastAttempt =
        attempt === MAX_BELL_CONNECT_ATTEMPTS - 1;

      if (isLastAttempt) {
        deps.onGaveUp(error);
        return;
      }

      await deps.wait(
        BELL_CONNECT_RETRY_DELAYS_MS[attempt] ?? 2000,
      );
    }
  }
}

export async function connectBellWithRetry(
  deps: BellConnectDeps,
): Promise<void> {
  console.log('[BLE] 하차벨 연결 시작');

  for (
    let attempt = 0;
    attempt < MAX_BELL_CONNECT_ATTEMPTS;
    attempt += 1
  ) {
    /**
     * 재시도 직전에 운행 유효성을 확인한다.
     *
     * 여기서 false라는 것은 화면이 바뀌었다는 뜻이 아니라,
     * 이 연결을 시작했던 운행 자체가 더 이상 현재 운행이 아니라는 뜻이다.
     */
    if (!deps.isStillWanted()) {
      console.log(
        '[BLE] 하차벨 연결 중단 - 연결을 시작한 운행이 더 이상 현재 운행이 아님',
      );
      deps.onCancelled();
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

      /**
       * BLE 작업이 진행되는 동안 운행이 취소되거나 새 운행으로
       * 바뀌었을 수 있으므로 성공 직후 다시 확인한다.
       */
      if (deps.isStillWanted()) {
        deps.onConnected();
      } else {
        console.log(
          '[BLE] 하차벨 연결은 성공했지만 운행이 이미 바뀜 - 늦은 연결 정리 시작',
        );
        await deps.onConnectedTooLate();
      }

      return;
    }

    console.log(
      `[BLE] 하차벨 연결 실패 ${attempt + 1}/${MAX_BELL_CONNECT_ATTEMPTS}`,
    );

    const isLastAttempt =
      attempt === MAX_BELL_CONNECT_ATTEMPTS - 1;

    if (isLastAttempt) {
      /**
       * 마지막 BLE 시도가 끝나는 동안 운행이 바뀌었다면 실패 안내가 아니라
       * 취소로 처리한다. 이전 운행의 실패가 새 운행에 끼어들면 안 된다.
       */
      if (!deps.isStillWanted()) {
        console.log(
          '[BLE] 하차벨 연결 최종 시도 후 운행이 바뀜 - 연결 시도 취소 처리',
        );
        deps.onCancelled();
        return;
      }

      console.log('[BLE] 하차벨 연결 최종 실패');
      deps.onGaveUp();
      return;
    }

    /**
     * 다음 시도 전에 다시 운행 유효성을 확인한다.
     * 이미 취소된 운행이라면 불필요하게 2초를 기다리지 않는다.
     */
    if (!deps.isStillWanted()) {
      console.log(
        '[BLE] 하차벨 연결 재시도 전 운행이 바뀜 - 연결 시도 취소 처리',
      );
      deps.onCancelled();
      return;
    }

    const retryDelay =
      BELL_CONNECT_RETRY_DELAYS_MS[attempt] ?? 2000;

    console.log(
      `[BLE] 하차벨 연결 재시도 전 ${retryDelay}ms 대기`,
    );

    await deps.wait(retryDelay);
  }
}