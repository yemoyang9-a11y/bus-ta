import { stopBeaconScanWithRetry } from "./beacon-scan-controller";

/**
 * 탑승이 확정되면 지팡이를 놓아준다.
 *
 * 지금까지는 비콘 스캔만 멈추고 BLE 연결은 그대로 뒀다. 승차 안내가 끝났는데도
 * 연결이 남아 지팡이 배터리를 계속 쓴다. 하차 안내는 하차벨 보드가 맡으므로
 * 탑승 뒤로는 지팡이를 붙들고 있을 이유가 없다.
 *
 * **순서가 이 모듈의 존재 이유다.** startBeaconScan/stopBeaconScan 은 지팡이에
 * 명령을 "써서" 동작한다(bleManager 의 writeCommand(CANE_DEVICE_NAME, ...)).
 * 연결을 먼저 끊으면 중지 명령이 전달되지 않고, 지팡이는 버스에 탄 뒤에도 계속
 * 스캔하며 진동한다. 그래서 중지가 실제로 성공한 뒤에만 끊는다.
 *
 * 중지가 상한까지 실패하면 끊지 않는다. 끊어 버리면 중지 명령을 다시 보낼 길이
 * 사라져 진동이 영영 멈추지 않는다. 배터리를 더 쓰더라도 연결을 남겨 두는 편이
 * 안전하다.
 *
 * 화면 밖으로 뺀 이유는 테스트 때문이다. RidingScreen 안에 두면 중지 실패와
 * 해지 실패의 조합을 검증할 방법이 없다(beacon-scan-controller 와 같은 이유).
 */
export type CaneReleaseDeps = {
  /**
   * 지금 비콘 스캔이 켜져 있는지. 켠 적이 없는 운행(도착정보가 없어 스캔이
   * 시작되지 않은 경우)에 굳이 중지 명령을 보내면, 실패했을 때 연결 해지까지 막힌다.
   */
  beaconScanActive: boolean;
  /** 지팡이에 스캔 중지 명령을 보낸다. 실패하면 reject 한다. */
  stopBeaconScan: () => Promise<void>;
  /** 지팡이 BLE 연결을 끊는다. 실패하면 reject 한다. */
  disconnectCane: () => Promise<void>;
  /** 스캔 중지에 성공했을 때. 앱 상태를 스캔 꺼짐으로 바꾼다. */
  onStopped: () => void;
  /** 연결까지 끊었을 때. */
  onReleased: () => void;
  /**
   * 실패했을 때. 어느 단계인지 함께 알린다.
   * STOP 이면 장치가 아직 스캔 중일 수 있어 앱 상태를 꺼짐으로 바꾸면 안 되고,
   * RELEASE 는 배터리만 더 쓰는 문제라 다음 운행에서 다시 붙이면 된다.
   */
  onFailed: (stage: "STOP" | "RELEASE", error: unknown) => void;
  /** 재시도 전 대기. 테스트에서 즉시 진행시키려고 주입받는다. */
  wait: (ms: number) => Promise<void>;
};

export async function releaseCaneAfterBoarding(
  deps: CaneReleaseDeps,
): Promise<void> {
  if (deps.beaconScanActive) {
    let stopped = false;

    await stopBeaconScanWithRetry({
      stopBeaconScan: deps.stopBeaconScan,
      onStopped: () => {
        stopped = true;
        deps.onStopped();
      },
      onGaveUp: (error) => deps.onFailed("STOP", error),
      wait: deps.wait,
    });

    // 멈추지 못했으면 연결을 남겨 둔다. 여기서 끊으면 진동이 영영 멈추지 않는다.
    if (!stopped) return;
  }

  try {
    await deps.disconnectCane();
    deps.onReleased();
  } catch (error) {
    // 호출부는 화면의 useEffect 다. 던지면 처리되지 않은 rejection 이 된다.
    deps.onFailed("RELEASE", error);
  }
}
