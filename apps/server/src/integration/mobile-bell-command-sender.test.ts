import assert from "node:assert/strict";
import test from "node:test";
import {
  sendStopRequestWithReconnect,
  type BellCommandDeps,
} from "../../../mobile/src/ble/bell-command-sender.js";

// ─────────────────────────────────────────────
// STOP_REQUEST 전송 직전 구간.
//
// 예모님 지적(2026-09-04, 두 가지):
//
// 하나. 연결 확인이 Map 조회였다. 버스 안에서 BLE 가 끊겨도 Map 에는 남아 "연결됨"으로
// 보였고, 재연결을 건너뛴 채 명령을 보내 실패했다. "끊겼으면 다시 붙인다"가 실제로는
// 보장되지 않았다.
//
// 둘. 명령 전송이 던져두기였다. write 가 한 번 실패해도 10초 타임아웃을 그대로 기다렸다.
// 연결 시점만 고쳐서는 이 구간에서 여전히 벨이 안 울린다.
// ─────────────────────────────────────────────

function makeDeps(overrides: Partial<BellCommandDeps> = {}) {
  const calls = {
    connects: 0,
    subscribes: 0,
    unsubscribes: 0,
    sends: 0,
  };

  const deps: BellCommandDeps = {
    isConnected: async () => true,
    connect: async () => {
      calls.connects += 1;
      return { id: "bell" };
    },
    subscribeResult: () => {
      calls.subscribes += 1;
      return () => {
        calls.unsubscribes += 1;
      };
    },
    sendStopRequest: async () => {
      calls.sends += 1;
    },
    ...overrides,
  };

  return { deps, calls };
}

test("이미 연결돼 있으면 다시 연결하지 않고 바로 보낸다", async () => {
  const { deps, calls } = makeDeps();

  const outcome = await sendStopRequestWithReconnect(deps);

  assert.equal(outcome.sent, true);
  assert.equal(calls.connects, 0);
  assert.equal(calls.sends, 1);
  assert.equal(calls.subscribes, 1);
});

test("Map 에는 있어도 실제로 끊겼으면 다시 연결한 뒤 보낸다", async () => {
  let reallyConnected = false;
  const { deps, calls } = makeDeps({
    // 실제 장치에 물어본 값. Map 조회였다면 여기서 true 가 나와 재연결을 건너뛰었다.
    isConnected: async () => reallyConnected,
    connect: async () => {
      reallyConnected = true;
      return { id: "bell" };
    },
  });

  const outcome = await sendStopRequestWithReconnect(deps);

  assert.equal(outcome.sent, true);
  assert.equal(calls.sends, 1);
});

test("재연결에 실패하면 결과를 기다리지 않고 실패로 끝낸다", async () => {
  const { deps, calls } = makeDeps({
    isConnected: async () => false,
    connect: async () => {
      throw new Error("연결 실패");
    },
  });

  const outcome = await sendStopRequestWithReconnect(deps);

  // sent 가 false 면 화면은 10초를 기다리지 않고 바로 실패를 안내한다.
  assert.equal(outcome.sent, false);
  assert.equal(calls.sends, 0);
  assert.equal(calls.subscribes, 0);
});

test("연결됐다고 나와도 구독이 실패하면 실패로 끝낸다", async () => {
  const { deps, calls } = makeDeps({
    subscribeResult: () => {
      throw new Error("BLE_NOT_CONNECTED");
    },
  });

  const outcome = await sendStopRequestWithReconnect(deps);

  assert.equal(outcome.sent, false);
  assert.equal(calls.sends, 0);
});

test("첫 전송이 실패하면 다시 붙여 한 번 더 보낸다", async () => {
  let sendAttempts = 0;
  let reconnects = 0;
  let connected = true;
  const { deps, calls } = makeDeps({
    isConnected: async () => connected,
    // override 로 넘기면 makeDeps 의 세는 stub 이 덮어써지므로 여기서 따로 센다.
    connect: async () => {
      reconnects += 1;
      connected = true;
      return { id: "bell" };
    },
    sendStopRequest: async () => {
      sendAttempts += 1;
      if (sendAttempts === 1) {
        // write 실패는 연결이 끊긴 신호일 수 있다.
        connected = false;
        throw new Error("GATT write 실패");
      }
    },
  });

  const outcome = await sendStopRequestWithReconnect(deps);

  assert.equal(outcome.sent, true);
  assert.equal(sendAttempts, 2);
  assert.equal(reconnects, 1);
  // 죽은 연결에 붙어 있던 이전 구독은 반드시 해제하고 다시 구독해야 결과가 온다.
  assert.equal(calls.unsubscribes, 1);
  assert.equal(calls.subscribes, 2);
});

test("두 번째 전송도 실패하면 구독을 정리하고 실패로 끝낸다", async () => {
  // override 로 넘기면 makeDeps 의 세는 stub 이 덮어써지므로 여기서 따로 센다.
  let sendAttempts = 0;
  const { deps, calls } = makeDeps({
    sendStopRequest: async () => {
      sendAttempts += 1;
      throw new Error("GATT write 실패");
    },
  });

  const outcome = await sendStopRequestWithReconnect(deps);

  assert.equal(outcome.sent, false);
  assert.equal(sendAttempts, 2);
  // 구독이 남으면 화면을 떠난 뒤에도 콜백이 살아 있다.
  assert.equal(calls.unsubscribes, calls.subscribes);
});

test("성공하면 해제 함수를 돌려줘 화면이 정리할 수 있게 한다", async () => {
  const { deps, calls } = makeDeps();

  const outcome = await sendStopRequestWithReconnect(deps);
  outcome.unsubscribe();

  assert.equal(calls.unsubscribes, 1);
});
