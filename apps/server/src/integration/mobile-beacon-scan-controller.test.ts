import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BEACON_SCAN_ATTEMPTS,
  startBeaconScanWithRetry,
  type BeaconScanControllerDeps,
} from "../../../mobile/src/ble/beacon-scan-controller.js";

// ─────────────────────────────────────────────
// 비콘 스캔 시작 재시도.
//
// 예모님 재지적(2026-09-04, PR #47): caneReady 가 true 가 된 뒤에도 실제
// startBeaconScan() 의 BLE write 가 실패할 수 있는데, 그때 화면 effect 의 의존값이
// 하나도 바뀌지 않아 재시도가 걸리지 않았다. 그 운행 내내 스캔이 꺼진 채 남는다.
// ─────────────────────────────────────────────

function makeDeps(overrides: Partial<BeaconScanControllerDeps> = {}) {
  const calls = {
    started: 0,
    startedTooLate: 0,
    gaveUp: 0,
    attempts: 0,
    waits: [] as number[],
  };

  const deps: BeaconScanControllerDeps = {
    startBeaconScan: async () => {
      calls.attempts += 1;
    },
    isStillWanted: () => true,
    onStarted: () => {
      calls.started += 1;
    },
    onStartedTooLate: () => {
      calls.startedTooLate += 1;
    },
    onGaveUp: () => {
      calls.gaveUp += 1;
    },
    // 테스트에서는 기다리지 않는다. 실제 지연은 controller 상수가 갖고 있다.
    wait: async (ms: number) => {
      calls.waits.push(ms);
    },
    ...overrides,
  };

  return { deps, calls };
}

test("첫 시도에 성공하면 재시도 없이 스캔 중으로 표시한다", async () => {
  const { deps, calls } = makeDeps();

  await startBeaconScanWithRetry(deps);

  assert.equal(calls.attempts, 1);
  assert.equal(calls.started, 1);
  assert.equal(calls.gaveUp, 0);
  assert.deepEqual(calls.waits, []);
});

test("첫 START_BEACON_SCAN 이 실패해도 재시도해서 성공한다", async () => {
  // 예모님이 요청한 회귀 시나리오. 이 동작이 없으면 한 번 실패한 뒤 그 운행
  // 내내 스캔이 꺼진 채로 남는다.
  let attempt = 0;
  const { deps, calls } = makeDeps({
    startBeaconScan: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("BLE_NOT_CONNECTED");
    },
  });

  await startBeaconScanWithRetry(deps);

  assert.equal(attempt, 2, "실패 뒤 한 번 더 시도해야 한다");
  assert.equal(calls.started, 1, "재시도가 성공하면 스캔 중으로 표시한다");
  assert.equal(calls.gaveUp, 0);
  assert.deepEqual(calls.waits, [1000], "첫 재시도 전에는 1초 기다린다");
});

test("상한까지 모두 실패하면 멈추고 한 번만 알린다", async () => {
  let attempt = 0;
  const { deps, calls } = makeDeps({
    startBeaconScan: async () => {
      attempt += 1;
      throw new Error("BLE_NOT_CONNECTED");
    },
  });

  await startBeaconScanWithRetry(deps);

  assert.equal(attempt, MAX_BEACON_SCAN_ATTEMPTS, "상한을 넘겨 시도하지 않는다");
  assert.equal(calls.started, 0);
  assert.equal(calls.gaveUp, 1, "조용히 끝내지 않고 한 번 알린다");
  assert.deepEqual(calls.waits, [1000, 2000], "간격이 늘어난다");
});

test("재시도를 기다리는 동안 탑승·취소되면 더 시도하지 않는다", async () => {
  // 대기 중에 사용자가 버스에 타면 스캔은 더 이상 필요 없다. 계속 시도하면
  // 탑승한 뒤에 지팡이가 진동하기 시작한다.
  let attempt = 0;
  let wanted = true;
  const { deps, calls } = makeDeps({
    startBeaconScan: async () => {
      attempt += 1;
      throw new Error("BLE_NOT_CONNECTED");
    },
    isStillWanted: () => wanted,
    wait: async () => {
      wanted = false;
    },
  });

  await startBeaconScanWithRetry(deps);

  assert.equal(attempt, 1, "취소된 뒤에는 다시 시도하지 않는다");
  assert.equal(calls.started, 0);
  assert.equal(calls.gaveUp, 0, "사용자가 그만둔 것이므로 실패 안내도 하지 않는다");
});

test("명령이 오가는 동안 탑승하면 늦은 성공으로 스캔을 켜지 않는다", async () => {
  // 시작 요청이 진행 중일 때 탑승이 확정될 수 있다. 그 요청이 뒤늦게 성공하면
  // 이미 끝난 대기 구간에서 스캔이 켜지고 진동이 계속된다.
  let wanted = true;
  const { deps, calls } = makeDeps({
    startBeaconScan: async () => {
      wanted = false;
    },
    isStillWanted: () => wanted,
  });

  await startBeaconScanWithRetry(deps);

  assert.equal(calls.started, 0, "끝난 운행에서 스캔 중으로 표시하면 안 된다");
  assert.equal(calls.startedTooLate, 1, "켜진 스캔을 되돌릴 기회를 준다");
});
