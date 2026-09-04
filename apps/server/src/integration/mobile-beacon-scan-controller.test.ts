import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BEACON_SCAN_ATTEMPTS,
  startBeaconScanWithRetry,
  stopBeaconScanWithRetry,
  type BeaconScanControllerDeps,
  type BeaconScanStopDeps,
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

// ─────────────────────────────────────────────
// 스캔 중지 재시도.
//
// 예모님 재지적(2026-09-04, PR #47 P1): 늦게 성공한 시작을 되돌리는 중지가 한 번만
// 호출되고 실패를 무시했다. 그 중지가 실패하면 실제 지팡이는 스캔이 켜진 채인데 앱
// 상태는 꺼짐이라, 뒤이은 탑승·취소 종료 경로도 다시 끄지 않아 영구히 어긋난다.
// ─────────────────────────────────────────────

function makeStopDeps(overrides: Partial<BeaconScanStopDeps> = {}) {
  const calls = { attempts: 0, stopped: 0, gaveUp: 0, waits: [] as number[] };

  const deps: BeaconScanStopDeps = {
    stopBeaconScan: async () => {
      calls.attempts += 1;
    },
    onStopped: () => {
      calls.stopped += 1;
    },
    onGaveUp: () => {
      calls.gaveUp += 1;
    },
    wait: async (ms: number) => {
      calls.waits.push(ms);
    },
    ...overrides,
  };

  return { deps, calls };
}

test("중지가 첫 시도에 성공하면 스캔 꺼짐으로 표시한다", async () => {
  const { deps, calls } = makeStopDeps();

  await stopBeaconScanWithRetry(deps);

  assert.equal(calls.attempts, 1);
  assert.equal(calls.stopped, 1);
  assert.equal(calls.gaveUp, 0);
});

test("첫 STOP_BEACON_SCAN 이 실패해도 재시도해서 성공한다", async () => {
  let attempt = 0;
  const { deps, calls } = makeStopDeps({
    stopBeaconScan: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("GATT_ERROR");
    },
  });

  await stopBeaconScanWithRetry(deps);

  assert.equal(attempt, 2);
  assert.equal(calls.stopped, 1, "재시도가 성공하면 꺼짐으로 표시한다");
  assert.equal(calls.gaveUp, 0);
  assert.deepEqual(calls.waits, [1000]);
});

test("중지가 상한까지 실패하면 꺼짐으로 표시하지 않는다", async () => {
  // 실제 장치는 켜져 있을 수 있다. 꺼짐으로 기록하면 뒤이은 종료 경로가 다시
  // 끄지 않아 상태와 장치가 영구히 어긋난다.
  let attempt = 0;
  const { deps, calls } = makeStopDeps({
    stopBeaconScan: async () => {
      attempt += 1;
      throw new Error("GATT_ERROR");
    },
  });

  await stopBeaconScanWithRetry(deps);

  assert.equal(attempt, MAX_BEACON_SCAN_ATTEMPTS);
  assert.equal(calls.stopped, 0, "성공하지 않았으므로 꺼짐으로 표시하면 안 된다");
  assert.equal(calls.gaveUp, 1);
});

test("시작 진행 중 탑승 → 늦은 성공 → 첫 중지 실패 → 재시도 중지 성공", async () => {
  // 예모님이 요청한 회귀 시나리오. 시작과 중지가 이어지는 전체 경로를 한 번에 본다.
  let wanted = true;
  let stopAttempt = 0;
  let stopped = false;
  let markedActiveForLaterCleanup = false;

  await startBeaconScanWithRetry({
    startBeaconScan: async () => {
      // 명령이 오가는 동안 사용자가 버스에 탔다.
      wanted = false;
    },
    isStillWanted: () => wanted,
    onStarted: () => {
      assert.fail("끝난 대기 구간에서 스캔 중으로 표시하면 안 된다");
    },
    onStartedTooLate: () =>
      stopBeaconScanWithRetry({
        stopBeaconScan: async () => {
          stopAttempt += 1;
          if (stopAttempt === 1) throw new Error("GATT_ERROR");
          stopped = true;
        },
        onStopped: () => undefined,
        onGaveUp: () => {
          markedActiveForLaterCleanup = true;
        },
        wait: async () => undefined,
      }),
    onGaveUp: () => assert.fail("시작은 실패하지 않았다"),
    wait: async () => undefined,
  });

  assert.equal(stopAttempt, 2, "첫 중지가 실패하면 한 번 더 시도해야 한다");
  assert.equal(stopped, true, "재시도로 실제 스캔이 꺼져야 한다");
  assert.equal(
    markedActiveForLaterCleanup,
    false,
    "재시도가 성공했으므로 켜진 것으로 남길 필요가 없다",
  );
});
