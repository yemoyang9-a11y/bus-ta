import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as assistStatus from '../../../mobile/src/realtime/assist-device-status.js';
import * as bellController from '../../../mobile/src/ble/bell-connect-controller.js';
import * as statusSnapshot from '../../../mobile/src/realtime/status-snapshot.js';

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

// 화면/Provider의 실제 소스와 effect 의존성을 실행한다. RN/외부 IO만 대체한다.
function hooks() {
  const slots: any[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  return {
    React: {
      createElement: (_type: unknown, props: unknown) => ({ props }),
      createContext: () => ({ Provider: 'Provider' }),
      useRef: (value: unknown) => slots[cursor++] ??= { current: value },
      useState: (value: unknown) => [value, () => {}],
      useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
        const index = cursor++;
        const old = slots[index];
        if (!old || deps.some((value, i) => old.deps[i] !== value)) {
          effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
        }
      },
    },
    render(component: () => any) {
      cursor = 0;
      effects = [];
      const value = component();
      effects.forEach((effect) => effect());
      return value;
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

function load(path: string, modules: Record<string, unknown>) {
  const exports: any = {};
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, {
    fileName: path.endsWith('.js') ? 'Screen.jsx' : path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, {
    exports, console,
    // 재시도만 microtask로 진행하고 GPS/화면 안내 timer는 실행하지 않는다.
    setTimeout: (callback: () => void, ms: number) => { if (ms === 2000) queueMicrotask(callback); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected module ${name}`);
      return modules[name];
    },
  });
  return exports;
}

function setup() {
  const providerHooks = hooks();
  const screenHooks = hooks();
  let state: any = { tripId: 'A', tripStatus: 'ON_BUS', boardingConfirmedAt: 'now', bellConnected: null,
    targetBeaconId: 'BUS_A', beaconPreparationCompleted: true, beaconScanActive: false };
  let delivered = true;
  let realtime: any;
  const calls = { events: [] as any[], speech: [] as string[], releases: [] as string[], connects: 0, actions: [] as any[],
    caneReleases: [] as Array<{ beaconScanActive: boolean }>, caneDisconnects: 0 };
  const shared = {
    'expo-speech': { speak: (message: string) => calls.speech.push(message), stop() {} },
    'expo-location': { requestForegroundPermissionsAsync: () => new Promise(() => {}) },
    '../state/TripContext': { useTrip: () => ({ state, dispatch: (action: any) => calls.actions.push(action) }) },
    '../api/client': { ApiError: class extends Error {}, apiClient: {} },
    '../ble/bleManager': {
      connectBell: async () => { calls.connects++; return null; },
      disconnectBellsForTrip: async (tripId: string) => { calls.releases.push(tripId); },
      stopBeaconScan: async () => {},
      startBeaconScan: async () => {},
      disconnectCane: async () => { calls.caneDisconnects++; },
    },
  };
  const Provider = load('../../../mobile/src/realtime/RealtimeProvider.tsx', {
    ...shared, react: providerHooks.React,
    './session': { HaneumRealtimeSession: class { notifyAssistDeviceStatusChange(event: any) { calls.events.push(event); return delivered; } } },
    './context': { createRealtimeGuideContext: () => ({}) },
    './connect-best-effort': {},
    './location-refresh': { createLocationRefreshCoordinator: () => async () => {} },
    './assist-device-preparation': { createAssistDevicePreparation: () => ({ prepare() {} }) },
    './assist-device-status': assistStatus,
  }).RealtimeProvider;
  const Screen = load('../../../mobile/src/screens/RidingScreen.js', {
    ...shared,
    react: screenHooks.React,
    'react-native': { StyleSheet: { create: (value: unknown) => value } },
    '@react-navigation/native': { useFocusEffect() {} },
    '../state/trip-transition': {
      isScreenTripActive: (active: string, screen: string) => active === screen,
    },
    '../realtime/RealtimeProvider': { useRealtime: () => realtime },
    '../realtime/assist-device-status': assistStatus,
    '../realtime/status-snapshot': statusSnapshot,
    '../ble/beacon-scan-gate': { canStartBeaconScan: () => false },
    '../ble/beacon-scan-controller': {},
    // 탑승이 확정되면 화면이 지팡이를 놓아주는지 여기서 확인한다. 실제 중지·해지
    // 순서는 mobile-cane-release-controller.test.ts 가 따로 검증한다.
    '../ble/cane-release-controller': {
      releaseCaneAfterBoarding: async (deps: any) => {
        calls.caneReleases.push({ beaconScanActive: deps.beaconScanActive });
        await deps.disconnectCane();
        deps.onReleased();
      },
    },
    '../ble/bell-connect-controller': bellController,
  }).default;
  return {
    calls,
    provider(next = state) {
      state = next;
      realtime = providerHooks.render(() => Provider({ children: null })).props.value;
    },
    screen(tripId = state.tripId) {
      screenHooks.render(() => Screen({ route: { params: { tripId } }, navigation: {} }));
    },
    offline() { delivered = false; },
    leaveRiding() { screenHooks.unmount(); },
    dispose() { screenHooks.unmount(); providerHooks.unmount(); },
    get state() { return state; },
  };
}

for (const offline of [false, true]) {
  test(`bell 최종 실패는 공식 notifyFailure 경로를 사용한다 (offline=${offline})`, async () => {
    const app = setup();
    if (offline) app.offline();
    app.provider();
    app.screen();
    await flush();
    assert.equal(app.calls.connects, 2);
    assert.equal(app.calls.events.length, 1);
    assert.equal(app.calls.events[0].device, 'BELL');
    assert.equal(app.calls.events[0].attempted, true);
    assert.equal(app.calls.events[0].retryable, false);
    assert.deepEqual(app.calls.speech, offline ? [assistStatus.getAssistDeviceFallbackMessage(app.calls.events[0])] : []);
    app.dispose();
  });
}

test('Riding을 떠나 Alight로 이동해도 유지하고 실제 취소/교체 때 A만 정리한다', async () => {
  const app = setup();
  app.provider();
  app.screen();
  await flush();
  app.leaveRiding();
  app.provider({ ...app.state, tripStatus: 'NEAR_DESTINATION' });
  assert.deepEqual(app.calls.releases, []);
  app.provider({ ...app.state, tripId: 'B', targetBeaconId: 'BUS_B' });
  assert.deepEqual(app.calls.releases, ['A']);
  app.provider({ ...app.state, tripStatus: 'CANCELLED' });
  assert.deepEqual(app.calls.releases, ['A', 'B']);
  app.dispose();
});

test('대상 정보가 없는 bell 실패도 공식 경로로 attempted=false를 전달한다', async () => {
  const app = setup();
  app.provider({ ...app.state, targetBeaconId: null });
  app.screen();
  await flush();
  assert.equal(app.calls.connects, 0);
  assert.equal(app.calls.events.length, 1);
  assert.equal(app.calls.events[0].device, 'BELL');
  assert.equal(app.calls.events[0].attempted, false);
  assert.deepEqual(app.calls.speech, []);
  app.dispose();
});

test('탑승이 확정되면 화면이 지팡이 연결을 놓아준다', async () => {
  // 승차 안내(버스 접근 진동)가 끝났는데 BLE 연결이 남으면 지팡이 배터리를 계속 쓴다.
  // 지금까지 화면은 비콘 스캔만 멈추고 연결은 그대로 뒀다.
  const app = setup();
  app.provider();
  app.screen();
  await flush();

  assert.equal(app.calls.caneReleases.length, 1, '탑승 확정 시 한 번 놓아준다');
  assert.equal(app.calls.caneDisconnects, 1);
  assert.equal(
    app.calls.releases.length,
    0,
    '하차벨은 하차까지 필요하므로 여기서 정리하지 않는다',
  );
  app.dispose();
});
