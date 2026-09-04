import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BELL_CONNECT_ATTEMPTS,
  connectBellWithRetry,
  type BellConnectDeps,
} from "../../../mobile/src/ble/bell-connect-controller.js";

// ─────────────────────────────────────────────
// 하차벨 연결을 탑승 확정 뒤로 옮기면서 생긴 재시도.
//
// 2026-09-04 실차 시험에서 하차벨이 두 번 다 울리지 않았다. 운행을 만드는 시점에
// 지팡이와 함께 연결을 시도했는데, 그때 하차벨 보드는 아직 오지 않은 버스 안이라
// BLE 범위 밖이었다. 실패한 뒤 다시 찾는 코드가 없어 그 운행 내내 연결이 없었고,
// 하차 화면은 연결 없음을 보고 1초 만에 실패로 확정했다.
// ─────────────────────────────────────────────

function makeDeps(overrides: Partial<BellConnectDeps> = {}) {
  const calls = {
    attempts: 0,
    connected: 0,
    connectedTooLate: 0,
    gaveUp: 0,
    waits: [] as number[],
  };

  const deps: BellConnectDeps = {
    connectBell: async () => {
      calls.attempts += 1;
      return { id: "bell" };
    },
    isStillWanted: () => true,
    onConnected: () => {
      calls.connected += 1;
    },
    onConnectedTooLate: () => {
      calls.connectedTooLate += 1;
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

test("한 번에 연결되면 재시도하지 않는다", async () => {
  const { deps, calls } = makeDeps();

  await connectBellWithRetry(deps);

  assert.equal(calls.attempts, 1);
  assert.equal(calls.connected, 1);
  assert.equal(calls.waits.length, 0);
  assert.equal(calls.gaveUp, 0);
});

test("버스 안에서 한 번 실패해도 다시 시도해 연결한다", async () => {
  let attempt = 0;
  const { deps, calls } = makeDeps({
    // bleManager 의 연결은 못 찾으면 null 을 돌려준다. 실패는 예외가 아니다.
    connectBell: async () => {
      attempt += 1;
      return attempt === 1 ? null : { id: "bell" };
    },
  });

  await connectBellWithRetry(deps);

  assert.equal(attempt, 2);
  assert.equal(calls.connected, 1);
  assert.deepEqual(calls.waits, [1000]);
  assert.equal(calls.gaveUp, 0);
});

test("예외로 실패해도 null 과 똑같이 재시도한다", async () => {
  let attempt = 0;
  const { deps, calls } = makeDeps({
    connectBell: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("BLE 스캔 오류");
      return { id: "bell" };
    },
  });

  await connectBellWithRetry(deps);

  assert.equal(attempt, 2);
  assert.equal(calls.connected, 1);
});

test("상한까지 실패하면 조용히 끝내지 않고 알린다", async () => {
  let attempt = 0;
  const { deps, calls } = makeDeps({
    connectBell: async () => {
      attempt += 1;
      return null;
    },
  });

  await connectBellWithRetry(deps);

  assert.equal(attempt, MAX_BELL_CONNECT_ATTEMPTS);
  assert.equal(calls.connected, 0);
  // 사용자가 내릴 때가 되어서야 벨이 안 눌린다는 것을 알면 늦는다.
  assert.equal(calls.gaveUp, 1);
  assert.deepEqual(calls.waits, [1000, 2000]);
});

test("기다리는 사이 운행이 끝나면 더 시도하지 않는다", async () => {
  let wanted = true;
  let attempt = 0;
  const { deps, calls } = makeDeps({
    connectBell: async () => {
      attempt += 1;
      wanted = false;
      return null;
    },
    isStillWanted: () => wanted,
  });

  await connectBellWithRetry(deps);

  assert.equal(attempt, 1);
  // 끝난 운행에서 실패를 안내하면 사용자는 무슨 벨인지 모른다.
  assert.equal(calls.gaveUp, 0);
});

test("늦게 연결됐는데 운행이 끝났으면 연결을 되돌린다", async () => {
  let wanted = true;
  const { deps, calls } = makeDeps({
    connectBell: async () => {
      wanted = false;
      return { id: "bell" };
    },
    isStillWanted: () => wanted,
  });

  await connectBellWithRetry(deps);

  assert.equal(calls.connected, 0);
  // 끊지 않으면 다음 운행에 이전 버스의 벨 연결이 남는다.
  assert.equal(calls.connectedTooLate, 1);
});

test("되돌리기가 끝날 때까지 기다린다", async () => {
  let wanted = true;
  let disconnectFinished = false;
  const { deps } = makeDeps({
    connectBell: async () => {
      wanted = false;
      return { id: "bell" };
    },
    isStillWanted: () => wanted,
    onConnectedTooLate: async () => {
      await Promise.resolve();
      disconnectFinished = true;
    },
  });

  await connectBellWithRetry(deps);

  assert.equal(disconnectFinished, true);
});

test("시작할 때 이미 운행이 끝났으면 연결을 시도조차 하지 않는다", async () => {
  const { deps, calls } = makeDeps({ isStillWanted: () => false });

  await connectBellWithRetry(deps);

  assert.equal(calls.attempts, 0);
  assert.equal(calls.gaveUp, 0);
});
