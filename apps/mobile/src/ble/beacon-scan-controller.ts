/**
 * 비콘 스캔 시작을 제한된 횟수만큼 재시도한다.
 *
 * 예모님 재지적(2026-09-04, PR #47): caneReady 가 true 가 된 뒤에도 실제
 * startBeaconScan() 의 BLE write 가 일시적으로 실패할 수 있다. 그때 화면의 effect
 * 의존값(shouldScanBeacon, caneReady, beaconScanActive)은 하나도 바뀌지 않으므로
 * effect 가 다시 돌지 않는다. catch 에 적혀 있던 "다음 주기에 재시도"는 실제로
 * 일어나지 않았고, 그 운행 내내 스캔이 꺼진 채로 남았다.
 *
 * 재시도를 넣으면 새 위험이 생긴다. 대기 중에 사용자가 버스에 타거나 운행을
 * 취소하면, 늦게 성공한 시작 요청이 이미 끝난 운행에서 스캔을 켠다. 그래서 매
 * 시도 직전과 성공 직후에 "아직 이 운행에서 스캔을 원하는가"를 다시 묻는다.
 *
 * 화면 밖으로 뺀 이유는 테스트 때문이다. RidingScreen 안에 두면 Promise 실패,
 * 지연, 운행 변경을 검증할 방법이 없다.
 */
export type BeaconScanControllerDeps = {
  /** 지팡이에 스캔 시작 명령을 보낸다. 실패하면 reject 한다. */
  startBeaconScan: () => Promise<void>;
  /**
   * 지금도 이 운행에서 스캔을 원하는지. 운행이 바뀌었거나 탑승이 확정됐거나
   * 취소됐으면 false 를 돌려준다.
   */
  isStillWanted: () => boolean;
  /** 시작에 성공했고 아직 유효할 때. 앱 상태를 스캔 중으로 바꾼다. */
  onStarted: () => void;
  /**
   * 늦게 성공했는데 이미 이 운행에서 스캔을 원하지 않을 때. 켜진 스캔을 되돌린다.
   * 이 정리를 안 하면 탑승한 뒤에도 지팡이가 계속 진동한다.
   *
   * 정리가 끝날 때까지 기다린다. 던져두면 실패해도 아무도 모르고, 앱 상태는
   * 스캔이 꺼진 것으로 남아 뒤이은 종료 경로도 다시 끄지 않는다.
   */
  onStartedTooLate: () => Promise<void> | void;
  /** 상한까지 모두 실패했을 때. 사용자에게 알릴 기회를 준다. */
  onGaveUp: (error: unknown) => void;
  /** 재시도 전 대기. 테스트에서 즉시 진행시키려고 주입받는다. */
  wait: (ms: number) => Promise<void>;
};

/** 최초 1회 + 재시도 2회. 더 늘리면 버스가 이미 지나간 뒤에 켜진다. */
export const MAX_BEACON_SCAN_ATTEMPTS = 3;

/** 재시도 간격(ms). 1초 → 2초. 일시적인 BLE 혼잡을 넘기기에 충분하다. */
export const BEACON_SCAN_RETRY_DELAYS_MS = [1000, 2000];

export async function startBeaconScanWithRetry(
  deps: BeaconScanControllerDeps,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_BEACON_SCAN_ATTEMPTS; attempt += 1) {
    if (!deps.isStillWanted()) return;

    try {
      await deps.startBeaconScan();
    } catch (error) {
      const isLastAttempt = attempt === MAX_BEACON_SCAN_ATTEMPTS - 1;
      if (isLastAttempt) {
        // 상한까지 실패했다. 조용히 끝내면 사용자는 버스가 와도 진동이 없는
        // 이유를 알 수 없다.
        if (deps.isStillWanted()) deps.onGaveUp(error);
        return;
      }

      await deps.wait(BEACON_SCAN_RETRY_DELAYS_MS[attempt] ?? 2000);
      continue;
    }

    // 성공했다. 다만 명령이 오가는 동안 탑승·취소가 끼어들 수 있으므로 다시 묻는다.
    if (deps.isStillWanted()) {
      deps.onStarted();
    } else {
      await deps.onStartedTooLate();
    }
    return;
  }
}


/**
 * 비콘 스캔 중지를 제한된 횟수만큼 재시도한다.
 *
 * 시작과 같은 이유로 필요하다. 화면의 중지 effect 들도 실패하면 의존값
 * (boardingConfirmedAt, beaconScanActive)이 그대로라 다시 돌지 않는다. 주석에 적힌
 * "다음 주기에 재시도"는 실제로 일어나지 않았다.
 *
 * 중지는 시작과 달리 취소 조건을 두지 않는다. 한 번 끄기로 했으면 끝까지 꺼야 한다.
 * 켜진 채로 남으면 사용자가 탄 뒤에도 지팡이가 계속 진동한다.
 */
export type BeaconScanStopDeps = {
  /** 지팡이에 스캔 중지 명령을 보낸다. 실패하면 reject 한다. */
  stopBeaconScan: () => Promise<void>;
  /** 중지에 성공했을 때. 앱 상태를 스캔 꺼짐으로 바꾼다. */
  onStopped: () => void;
  /**
   * 상한까지 모두 실패했을 때. 앱 상태를 스캔 꺼짐으로 바꾸면 안 된다. 실제 장치는
   * 켜져 있을 수 있으므로, 켜진 것으로 남겨 두어야 뒤이은 종료 경로가 다시 끈다.
   */
  onGaveUp: (error: unknown) => void;
  /** 재시도 전 대기. 테스트에서 즉시 진행시키려고 주입받는다. */
  wait: (ms: number) => Promise<void>;
};

export async function stopBeaconScanWithRetry(
  deps: BeaconScanStopDeps,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_BEACON_SCAN_ATTEMPTS; attempt += 1) {
    try {
      await deps.stopBeaconScan();
      deps.onStopped();
      return;
    } catch (error) {
      const isLastAttempt = attempt === MAX_BEACON_SCAN_ATTEMPTS - 1;
      if (isLastAttempt) {
        deps.onGaveUp(error);
        return;
      }

      await deps.wait(BEACON_SCAN_RETRY_DELAYS_MS[attempt] ?? 2000);
    }
  }
}
