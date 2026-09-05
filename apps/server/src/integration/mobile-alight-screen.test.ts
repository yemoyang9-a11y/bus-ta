import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createBellStopSession } from '../../../mobile/src/ble/bell-stop-session.js';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// RN 렌더러 대신 hook 수명 경계만 대체하고 실제 화면과 세션 코드를 실행한다.
function setup() {
  const slots: any[] = [];
  let cursor = 0;
  let effect: () => () => void;
  let cleanup: (() => void) | undefined;
  let connected = true;
  let resolveWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => { resolveWrite = resolve; });
  const callbacks: Array<(result: { result: string }) => void> = [];
  const calls = { sends: 0, removes: 0, results: [] as string[], states: [] as string[], dispatches: 0 };
  const React = {
    createElement: () => null,
    useRef: (value: unknown) => { const index = cursor++; return slots[index] ??= { current: value }; },
    useState: (value: string) => [value, (next: string) => calls.states.push(next)],
    useCallback: (callback: () => () => void, deps: unknown[]) => {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) slots[index] = { callback, deps };
      return slots[index].callback;
    },
  };
  const exports: any = {};
  const source = readFileSync(new URL('../../../mobile/src/screens/AlightScreen.js', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, {
    fileName: 'AlightScreen.jsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, {
    exports, console,
    require: (name: string) => {
      if (name === 'react') return React;
      if (name === 'react-native') return { StyleSheet: { create: (value: unknown) => value } };
      if (name === 'expo-speech') return { speak() {}, stop() {} };
      if (name === '@react-navigation/native') return { useFocusEffect: (next: typeof effect) => { effect = next; } };
      if (name === '../ble/bell-stop-session') return { createBellStopSession };
      if (name === '../state/TripContext') return { useTrip: () => ({
        state: { targetBeaconId: 'BUS_A', bleIsMock: false },
        dispatch: () => { calls.dispatches++; },
      }) };
      if (name === '../realtime/RealtimeProvider') return { useRealtime: () => ({ isConnected: connected }) };
      if (name === '../api/client') return { ApiError: class extends Error {}, apiClient: { trips: {
        bell: { result: async (tripId: string) => { calls.results.push(tripId); } },
        getStatus: async () => ({}),
      } } };
      if (name === '../ble/bleManager') return {
        isBellConnected: async () => true,
        connectBell: async () => ({}),
        sendStopRequest: () => { calls.sends++; return pendingWrite; },
        subscribeBellResult: (callback: typeof callbacks[number]) => {
          callbacks.push(callback);
          return () => { calls.removes++; };
        },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return {
    calls, callbacks, resolveWrite,
    render(tripId = 'A', realtimeConnected = true) {
      cursor = 0;
      connected = realtimeConnected;
      const previous = effect;
      exports.default({ route: { params: { tripId, bellRequestId: `bell-${tripId}`, command: 'STOP_REQUEST' } } });
      if (effect! !== previous || !cleanup) {
        cleanup?.();
        cleanup = effect!();
      }
    },
    blur() { cleanup?.(); cleanup = undefined; },
  };
}

test('Realtime 변화와 focus 재진입 중 pending STOP_REQUEST는 1회만 전송한다', async () => {
  const screen = setup();
  screen.render();
  await flush();
  screen.render('A', false);
  await flush();
  assert.equal(screen.calls.sends, 1);
  assert.equal(screen.calls.removes, 0);
  screen.blur();
  screen.render('A', false);
  await flush();
  assert.equal(screen.calls.sends, 1);
  assert.equal(screen.calls.removes, 1);
  assert.deepEqual(screen.calls.results, ['A']);
  screen.callbacks[0]!({ result: 'SUCCESS' });
  screen.resolveWrite();
  await flush();
  assert.equal(screen.calls.states.at(-1), 'fail');
  assert.deepEqual(screen.calls.results, ['A']);
  screen.blur();
});

test('운행 교체 후 이전 완료는 새 화면 상태/구독/결과를 변경하지 않는다', async () => {
  const screen = setup();
  screen.render('A');
  await flush();
  screen.render('B');
  await flush();
  assert.equal(screen.calls.sends, 2);
  assert.equal(screen.calls.removes, 1);
  screen.callbacks[0]!({ result: 'SUCCESS' });
  screen.resolveWrite();
  await flush();
  assert.equal(screen.calls.states.at(-1), 'waiting');
  assert.deepEqual(screen.calls.results, []);
  assert.equal(screen.calls.removes, 1);
  screen.callbacks[1]!({ result: 'SUCCESS' });
  await flush();
  assert.deepEqual(screen.calls.results, ['B']);
  assert.equal(screen.calls.states.at(-1), 'success');
  assert.equal(screen.calls.removes, 2);
  screen.blur();
  assert.equal(screen.calls.removes, 2);
});
