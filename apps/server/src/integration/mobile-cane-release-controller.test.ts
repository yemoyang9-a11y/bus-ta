import assert from "node:assert/strict";
import test from "node:test";
import {
  releaseCaneAfterBoarding,
  type CaneReleaseDeps,
} from "../../../mobile/src/ble/cane-release-controller.js";

// ─────────────────────────────────────────────
// 탑승이 확정되면 지팡이를 놓아준다.
//
// 지금까지는 비콘 스캔만 멈추고 BLE 연결은 그대로 뒀다. 승차 안내가 끝났는데도
// 연결이 남아 지팡이 배터리를 계속 쓴다.
//
// 순서가 중요하다. startBeaconScan/stopBeaconScan 은 지팡이에 명령을 "써서"
// 동작한다(bleManager 의 writeCommand(CANE_DEVICE_NAME, ...)). 연결을 먼저 끊으면
// 중지 명령이 전달되지 않아, 지팡이는 버스에 탄 뒤에도 계속 스캔하며 진동한다.
// ─────────────────────────────────────────────

function createDeps(overrides: Partial<CaneReleaseDeps> = {}): {
  deps: CaneReleaseDeps;
  calls: string[];
  events: string[];
} {
  const calls: string[] = [];
  const events: string[] = [];

  const deps: CaneReleaseDeps = {
    beaconScanActive: true,
    stopBeaconScan: async () => {
      calls.push("stop");
    },
    disconnectCane: async () => {
      calls.push("disconnect");
    },
    onStopped: () => events.push("stopped"),
    onReleased: () => events.push("released"),
    onFailed: (stage) => events.push(`failed:${stage}`),
    wait: async () => {},
    ...overrides,
  };

  return { deps, calls, events };
}

test("스캔을 먼저 멈추고 그다음에 연결을 끊는다", async () => {
  const { deps, calls, events } = createDeps();

  await releaseCaneAfterBoarding(deps);

  assert.deepEqual(calls, ["stop", "disconnect"], "순서가 뒤집히면 안 된다");
  assert.deepEqual(events, ["stopped", "released"]);
});

test("스캔 중지가 상한까지 실패하면 연결을 끊지 않는다", async () => {
  // 여기서 끊으면 중지 명령을 다시 보낼 길이 사라져, 지팡이가 탑승 뒤에도
  // 계속 진동한 채로 남는다. 배터리보다 이게 훨씬 나쁘다.
  const { deps, calls, events } = createDeps({
    stopBeaconScan: async () => {
      calls.push("stop");
      throw new Error("BLE write 실패");
    },
  });

  await releaseCaneAfterBoarding(deps);

  assert.equal(calls.includes("disconnect"), false, "끊으면 안 된다");
  assert.deepEqual(events, ["failed:STOP"]);
  assert.equal(events.includes("stopped"), false, "실제로 멈추지 않았으므로 멈췄다고 하지 않는다");
});

test("스캔 중지가 한 번 실패해도 재시도해서 성공하면 연결을 끊는다", async () => {
  let attempts = 0;
  const { deps, calls, events } = createDeps({
    stopBeaconScan: async () => {
      attempts += 1;
      calls.push("stop");
      if (attempts < 2) throw new Error("일시적인 BLE 혼잡");
    },
  });

  await releaseCaneAfterBoarding(deps);

  assert.equal(attempts, 2);
  assert.deepEqual(calls, ["stop", "stop", "disconnect"]);
  assert.deepEqual(events, ["stopped", "released"]);
});

test("스캔이 이미 꺼져 있으면 중지 명령 없이 바로 끊는다", async () => {
  // 스캔을 켠 적이 없는 운행(도착정보가 없어 스캔이 시작되지 않은 경우)에서
  // 굳이 중지 명령을 보내면, 실패했을 때 연결 해지까지 막힌다.
  const { deps, calls, events } = createDeps({ beaconScanActive: false });

  await releaseCaneAfterBoarding(deps);

  assert.deepEqual(calls, ["disconnect"]);
  assert.deepEqual(events, ["released"]);
});

test("연결 해지가 실패해도 스캔은 멈춘 것으로 남는다", async () => {
  // 해지 실패는 배터리만 더 쓰는 문제라 치명적이지 않다. 다만 조용히 삼키면
  // 다음 운행에서 같은 지팡이에 다시 붙을 때 원인을 알 수 없다.
  const { deps, events } = createDeps({
    disconnectCane: async () => {
      throw new Error("cancelConnection 실패");
    },
  });

  await releaseCaneAfterBoarding(deps);

  assert.deepEqual(events, ["stopped", "failed:RELEASE"]);
});

test("연결 해지 실패는 예외로 새어 나가지 않는다", async () => {
  // 호출부는 화면의 useEffect 다. 여기서 던지면 처리되지 않은 rejection 이 된다.
  const { deps } = createDeps({
    disconnectCane: async () => {
      throw new Error("cancelConnection 실패");
    },
  });

  await assert.doesNotReject(() => releaseCaneAfterBoarding(deps));
});
