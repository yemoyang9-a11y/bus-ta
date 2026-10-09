import assert from 'node:assert/strict';
import test from 'node:test';
import { createBellStopSession, BELL_RESULT_TIMEOUT_MS } from '../../../mobile/src/ble/bell-stop-session.js';
import { BELL_SEND_DEADLINE_MS } from '../../../mobile/src/ble/bell-command-sender.js';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(overrides = {}) {
  const calls = { sends: 0, subscribes: 0, removes: 0 };
  let notify: (value: { result: string }) => void = () => {};
  const flow = createBellStopSession({
    isConnected: async () => true,
    connect: async () => ({}),
    sendStopRequest: async () => { calls.sends++; },
    subscribeResult: (callback) => {
      notify = callback;
      calls.subscribes++;
      return () => { calls.removes++; };
    },
    ...overrides,
  });
  return { flow, calls, notify: (result: string) => notify({ result }) };
}

for (const stage of ['ensure', 'connect', 'write', 'reconnect'] as const) {
  test(`5초 전체 deadline: ${stage} 지연과 늦은 완료`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const pending = deferred<any>();
    let sends = 0;
    const { flow, calls, notify } = setup({
      isConnected: async () => stage === 'ensure' ? pending.promise : stage === 'connect' ? false : sends === 0,
      connect: () => pending.promise,
      sendStopRequest: async () => {
        sends++;
        if (stage === 'reconnect') throw new Error('write failed');
        return pending.promise;
      },
    });
    let completions = 0;
    const result = flow.start().then((value) => { completions++; return value; });
    await flush();
    t.mock.timers.tick(BELL_SEND_DEADLINE_MS - 1);
    await flush();
    assert.equal(completions, 0);
    t.mock.timers.tick(1);
    assert.deepEqual(await result, { outcome: 'fail', sendFailed: true });
    const sendsAtDeadline = sends;
    pending.resolve(true);
    notify('SUCCESS');
    await flush();
    assert.equal(completions, 1);
    assert.equal(sends, sendsAtDeadline);
    assert.equal(calls.removes, calls.subscribes);
  });
}

test('전송 준비 4초 후 성공하면 그때부터 결과를 10초 기다린다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const pending = deferred<void>();
  const { flow, calls } = setup({ sendStopRequest: () => pending.promise });
  let completed = false;
  const result = flow.start().then((value) => { completed = true; return value; });
  await flush();
  t.mock.timers.tick(4000);
  pending.resolve();
  await flush();
  t.mock.timers.tick(BELL_RESULT_TIMEOUT_MS - 1);
  await flush();
  assert.equal(completed, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await result, { outcome: 'fail', sendFailed: false });
  assert.equal(calls.removes, 1);
});

test('첫 write 3초와 reconnect 대기는 같은 5초 예산을 공유한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const write = deferred<void>();
  const reconnect = deferred<void>();
  let connected = true;
  const { flow, calls } = setup({
    isConnected: async () => connected,
    sendStopRequest: async () => { await write.promise; connected = false; throw new Error('write failed'); },
    connect: () => reconnect.promise,
  });
  let completions = 0;
  const result = flow.start().then((value) => { completions++; return value; });
  await flush();
  t.mock.timers.tick(3000);
  write.resolve();
  await flush();
  t.mock.timers.tick(1999);
  await flush();
  assert.equal(completions, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(await result, { outcome: 'fail', sendFailed: true });
  reconnect.resolve();
  await flush();
  assert.equal(calls.subscribes, 1);
  assert.equal(calls.removes, 1);
});

test('pending 중 start 재호출은 동일 promise와 write 한 번만 사용한다', async () => {
  const pending = deferred<void>();
  let sends = 0;
  const { flow, calls, notify } = setup({ sendStopRequest: () => { sends++; return pending.promise; } });
  const first = flow.start();
  await flush();
  assert.equal(flow.start(), first);
  assert.equal(sends, 1);
  notify('SUCCESS'); // write 시작 뒤, 반환 전 빠른 Notify는 현재 요청의 결과다.
  assert.deepEqual(await first, { outcome: 'success', sendFailed: false });
  pending.resolve();
  await flush();
  assert.equal(flow.start(), first);
  assert.equal(calls.removes, 1);
});

test('cleanup 뒤 재진입과 stale Notify/write는 새 세션을 덮지 않는다', async () => {
  const pending = deferred<void>();
  const old = setup({ sendStopRequest: () => pending.promise });
  const first = old.flow.start();
  await flush();
  old.flow.cancel();
  assert.equal(old.flow.start(), first);
  assert.deepEqual(await first, { outcome: 'fail', sendFailed: true });
  const current = setup();
  const next = current.flow.start();
  await flush();
  old.notify('SUCCESS');
  pending.resolve();
  await flush();
  assert.equal(old.calls.removes, 1);
  assert.equal(current.calls.removes, 0);
  current.notify('SUCCESS');
  assert.deepEqual(await next, { outcome: 'success', sendFailed: false });
  assert.equal(current.calls.removes, 1);
});

test('STOP_REQUEST 시작 전 동기 Notify는 무시하고 실제 write를 수행한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let removes = 0;
  const { flow, calls } = setup({ subscribeResult: (callback: (value: { result: string }) => void) => {
    callback({ result: 'SUCCESS' });
    return () => { removes++; };
  } });
  let completed = false;
  const result = flow.start().then((value) => { completed = true; return value; });
  await flush();
  assert.equal(calls.sends, 1);
  assert.equal(completed, false);
  t.mock.timers.tick(BELL_RESULT_TIMEOUT_MS);
  assert.deepEqual(await result, { outcome: 'fail', sendFailed: false });
  assert.equal(removes, 1);
});
