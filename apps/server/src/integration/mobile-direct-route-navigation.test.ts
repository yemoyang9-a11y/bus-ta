import * as tripTransition from '../../../mobile/src/state/trip-transition.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { DEMO_ROUTE, type Route, type CreateTripResponse } from '@bus-ta/shared';
import { initialState, tripReducer } from '../../../mobile/src/state/trip-reducer.js';
import { getTripNavigationTarget } from '../../../mobile/src/state/trip-transition.js';
import { dispatchRealtimeFunctionCall } from '../../../mobile/src/realtime/function-dispatcher.js';
import { getSafeSpeech } from '../../../mobile/src/realtime/safe-speech.js';
import type { AppAction, AppTripState, RealtimeGuideContext } from '../../../mobile/src/realtime/types.js';

// The mobile package is CommonJS. Match the real dispatcher's require path when
// injecting its dependency into the VM screen. Node 22/tsx can otherwise load
// separate ESM and CJS instances, each with its own single-flight WeakMap.
const { startDirectTrip } = createRequire(new URL('../../../mobile/src/realtime/function-dispatcher.ts', import.meta.url))(
  '../state/direct-trip-selection',
) as typeof import('../../../mobile/src/state/direct-trip-selection.js');

function app(routes: Route[], create: () => Promise<CreateTripResponse>) {
  let state = tripReducer(initialState, { type: 'SET_DESTINATION_AND_ROUTES', destination: '목적지', routes });
  let focused = true;
  const refs: any[] = []; let cursor = 0;
  let effects: (() => void)[] = [];
  const navigation: any[] = [];
  const spoken: string[] = [];
  const cancelled: string[] = [];
  const cancel = async (tripId: string) => { cancelled.push(tripId); };
  const dispatch = (action: AppAction) => { state = tripReducer(state, action); };
  const getState = () => state as unknown as AppTripState;
  const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }),
    useState: (value: any) => [value, () => {}], useEffect: (effect: () => void) => effects.push(effect),
    useRef: (value: any) => refs[cursor++] ?? (refs[cursor - 1] = { current: value }) };
  const modules: Record<string, any> = {
    "../state/trip-transition": tripTransition,
    react, '@react-navigation/native': { useIsFocused: () => focused },
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'Button', FlatList: 'List', StyleSheet: { create: (x: any) => x } },
    '../state/TripContext': { useTrip: () => ({ state, dispatch }) },
    '../api/client': { apiClient: { trips: { create, end: (tripId: string) => cancel(tripId) } } },
    '../state/direct-trip-selection': { startDirectTrip },
    '../state/transfer-journey': { canStartJourney: (r: Route) => r.routeMode === 'MULTIMODAL' && r.journeySupported },
    '../ble/bleManager': { stopBeaconScan: async () => {} },
    'expo-speech': { speak: (text: string) => { spoken.push(text); }, stop: () => {} },
    '../realtime/safe-speech': { getSafeSpeech },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../../mobile/src/screens/RouteListScreen.js', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }, fileName: 'RouteListScreen.jsx',
  }).outputText, { exports, Date, require: (name: string) => modules[name] });
  const render = () => {
    cursor = 0; effects = [];
    const tree = exports.default({ navigation: { navigate: (...args: any[]) => navigation.push(args) } });
    effects.forEach(effect => effect());
    return tree.children.find((child: any) => child?.type === 'List');
  };
  render();
  const context: RealtimeGuideContext = { getAppState: getState, dispatchAppAction: dispatch,
    refreshCurrentLocation: async () => {}, getCurrentLocation: () => undefined };
  return { getState, dispatch, navigation, spoken, cancelled, render, context, focus: (value: boolean) => { focused = value; },
    press: (route: Route) => render().props.renderItem({ item: route, index: 0 }).props.onPress(),
    start: (route: Route) => startDirectTrip({ getState, dispatch, route, request: { ...route, destination: "목적지", routeMode: "DIRECT_BUS", tripSupported: true }, create, cancel, stopScan: async () => {} }),
  };
}
const response = (id = 'trip-direct') => ({ success: true, tripId: id }) as CreateTripResponse;
const route = (no: string, id = 1): Route => ({ ...DEMO_ROUTE, routeNo: no, candidateId: id });
const voice = (a: ReturnType<typeof app>, r: Route) => dispatchRealtimeFunctionCall({
  type: 'response.function_call_arguments.done', call_id: `voice-${r.routeNo}`, name: 'create_trip',
  arguments: JSON.stringify({ candidateId: r.candidateId }),
}, a.context);

for (const no of ['34', '1551', '82-1']) {
  test(`actual focused RouteList follows successful voice API for arbitrary route ${no}`, async t => {
    const r = route(no); let requests = 0;
    const a = app([r], async () => response());
    t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(JSON.stringify(response()), { status: 200 }); });
    await voice(a, r); a.render(); a.render();
    assert.equal(requests, 1); assert.equal(a.navigation.length, 1);
    assert.equal(a.navigation[0][0], 'Riding'); assert.equal(a.navigation[0][1].tripId, 'trip-direct');
    assert.equal(a.navigation[0][1].selectedRoute.routeNo, no);
    await a.press(r); assert.equal(requests, 1); assert.equal(a.navigation.length, 1);
  });
}
test('actual touch creates once and navigation uses committed winning route', async () => {
  const r = route('72'); let requests = 0; const a = app([r], async () => { requests++; return response(); });
  await a.press(r); a.render(); a.render();
  assert.equal(requests, 1); assert.equal(a.navigation.length, 1); assert.equal(a.navigation[0][1].selectedRoute, r);
});
for (const voiceFirst of [true, false]) test(`voice/touch share pending request, voiceFirst=${voiceFirst}`, async t => {
  const r = route('504'); let requests = 0; let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>(done => { markStarted = done; });
  const deferred = new Promise<void>(done => { release = done; });
  const create = async () => { requests++; markStarted(); await deferred; return response(); };
  const a = app([r], create);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(await create()), { status: 200 }));
  const first = voiceFirst ? voice(a, r) : a.press(r);
  await started;
  const second = voiceFirst ? a.press(r) : voice(a, r);
  await Promise.resolve(); release(); await Promise.all([first, second]); a.render();
  assert.equal(requests, 1); assert.equal(a.navigation.length, 1);
});
test('competing different candidates cannot overwrite winning trip or route', async () => {
  const r = route('17'), other = route('903', 2); let requests = 0; let release!: () => void;
  const a = app([r, other], async () => { requests++; await new Promise<void>(done => { release = done; }); return response(); });
  const first = a.start(r); await Promise.resolve();
  await assert.rejects(a.start(other), /다른 노선/); release(); await first;
  await a.press(other); a.render();
  assert.equal(requests, 1); assert.equal(a.getState().selectedRoute, r);
  assert.equal(a.navigation[0][1].selectedRoute, r);
});
test('failed and invalid API results do not navigate and release lock for retry', async () => {
  const r = route('44'); let attempts = 0;
  const a = app([r], async () => { attempts++; if (attempts === 1) throw Error('network');
    if (attempts === 2) return response(''); return response(); });
  await a.press(r); a.render(); assert.equal(a.navigation.length, 0);
  await a.press(r); a.render(); assert.equal(a.navigation.length, 0);
  await a.press(r); a.render(); assert.equal(attempts, 3); assert.equal(a.navigation.length, 1);
});
test('touch selection failure is spoken, not only shown', async () => {
  const r = route('34'); const a = app([r], async () => { throw Error('network'); });
  await a.press(r);
  assert.equal(a.navigation.length, 0);
  assert.equal(a.spoken.length, 1); assert.match(a.spoken[0] ?? '', /다시 선택/);
});
test('cancel and reselect creates a fresh trip; old response after reset cannot commit', async () => {
  const r = route('60'); let attempts = 0; let release!: () => void;
  const a = app([r], async () => { attempts++; if (attempts === 1) await new Promise<void>(done => { release = done; }); return response(`trip-${attempts}`); });
  const pending = a.start(r); await Promise.resolve();
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); release(); await assert.rejects(pending, /이전 응답/);
  await a.start(r); a.render(); assert.equal(a.getState().tripId, 'trip-2');
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); a.render(); await a.start(r); a.render();
  assert.equal(attempts, 3); assert.equal(a.getState().tripId, 'trip-3');
});
test('journey step confirm does not rewind selection generation onto a cancelled trip success', async () => {
  const r = route('60'); let attempts = 0;
  const journey: Route = { ...route('mixed', 2), routeMode: 'MULTIMODAL', journeySupported: true, tripSupported: false,
    segments: [{ mode: 'WALK', startName: 'A', endName: 'B', lineNames: [], routeNumbers: [] },
      { mode: 'BUS', startName: 'B', endName: 'C', lineNames: [], routeNumbers: ['60'], busLeg: DEMO_ROUTE }] };
  const a = app([r, journey], async () => { attempts++; return response(`trip-${attempts}`); });
  await a.start(r); assert.equal(a.getState().tripId, 'trip-1');
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' });
  a.dispatch({ type: 'START_JOURNEY', route: journey });
  a.dispatch({ type: 'CONFIRM_JOURNEY_STEP', expectedIndex: 0 });
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' });
  const result = await a.start(r);
  assert.equal(attempts, 2); assert.equal(result.tripId, 'trip-2'); assert.equal(a.getState().tripId, 'trip-2');
});
test('a discarded late create response cancels the orphan server trip', async () => {
  const r = route('61'); let release!: () => void;
  const a = app([r], async () => { await new Promise<void>(done => { release = done; }); return response('trip-orphan'); });
  const pending = a.start(r); await Promise.resolve();
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); release();
  await assert.rejects(pending, /이전 응답/);
  assert.deepEqual(a.cancelled, ['trip-orphan']); assert.equal(a.getState().tripId, null);
});
test('touch path cancels the orphan trip through the real screen wiring', async () => {
  const r = route('62'); let release!: () => void; let markStarted!: () => void;
  const started = new Promise<void>(done => { markStarted = done; });
  const a = app([r], async () => { markStarted(); await new Promise<void>(done => { release = done; }); return response('trip-touch-orphan'); });
  const pending = a.press(r); await started;
  // React re-renders the mounted screen after the reset, which refreshes latestRef.
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); a.render(); release(); await pending;
  assert.deepEqual(a.cancelled, ['trip-touch-orphan']); assert.equal(a.getState().tripId, null);
});
test('voice path cancels the orphan trip through the real end API', async t => {
  const r = route('63'); const requests: { method: string; url: string; body: unknown }[] = [];
  let release!: () => void; let markStarted!: () => void;
  const started = new Promise<void>(done => { markStarted = done; });
  const a = app([r], async () => response());
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    requests.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === 'POST') { markStarted(); await new Promise<void>(done => { release = done; }); return Response.json(response('trip-voice-orphan')); }
    return Response.json({ success: true, tripId: 'trip-voice-orphan', tripStatus: 'CANCELLED', message: '취소', timestamp: 'now' });
  });
  const pending = voice(a, r); await started;
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); release(); await pending;
  const end = requests.find(req => req.method === 'PATCH');
  assert.ok(end); assert.match(end.url, /trip-voice-orphan/); assert.deepEqual(end.body, { action: 'CANCEL' });
  assert.equal(a.getState().tripId, null);
});
test('actual RouteList transfer selection still dispatches journey and navigates Transfer', async () => {
  const r: Route = { ...route('mixed'), routeMode: 'MULTIMODAL', journeySupported: true, tripSupported: false,
    segments: [{ mode: 'BUS', startName: 'A', endName: 'B', lineNames: [], routeNumbers: ['60'], busLeg: DEMO_ROUTE }] };
  let requests = 0; const a = app([r], async () => { requests++; return response(); });
  await a.press(r); a.render();
  assert.equal(requests, 0); assert.equal(a.navigation[0][0], 'Transfer');
});

test('actual unfocused Main and RouteList do not intervene; focused RouteList resumes', async () => {
  const source = readFileSync(new URL('../../../mobile/src/screens/MainScreen.js', import.meta.url), 'utf8');
  const start = source.indexOf('useEffect(() => {', source.indexOf('// Function 결과'));
  const body = source.slice(start + 'useEffect(() => {'.length, source.indexOf('}, [', start));
  const calls: unknown[] = [];
  new Function('isFocused', 'journeyRoute', 'journeyPhase', 'tripId', 'selectedRoute', 'routeCandidates', 'navigation', 'getTripNavigationTarget', body)(
    false, null, null, 'trip-direct', DEMO_ROUTE, [DEMO_ROUTE], { navigate: (...args: unknown[]) => calls.push(args) }, getTripNavigationTarget);
  assert.equal(calls.length, 0);
  const r = route('109'); const a = app([r], async () => response());
  a.focus(false); await a.start(r); a.render(); assert.equal(a.navigation.length, 0);
  a.focus(true); a.render(); assert.equal(a.navigation[0][0], 'Riding');
});

test('different voice and touch candidates share exclusion without mismatching display', async t => {
  const winner = route('29'), other = route('704', 2);
  let requests = 0; let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>(done => { markStarted = done; });
  const a = app([winner, other], async () => { requests++; return response('unexpected'); });
  t.mock.method(globalThis, 'fetch', async () => { requests++;
    await new Promise<void>(done => { release = done; markStarted(); }); return Response.json(response()); });
  const pending = voice(a, winner); await started;
  await a.press(other);
  // Another selection is still running; telling the user to choose again would contradict it.
  assert.equal(a.spoken.length, 0);
  release(); await pending; a.render();
  assert.equal(requests, 1); assert.equal(a.navigation.length, 1);
  assert.equal(a.navigation[0][1].selectedRoute, winner);
});

test('a disconnected cane does not block selection; a connected stop failure still does', async () => {
  const r = route('300');
  const run = async (stopError: Error) => {
    let state = { ...initialState, routeCandidates: [r], routeCandidatesExpiresAt: Date.now() + 60000, beaconScanActive: true } as unknown as AppTripState;
    let requests = 0;
    const result = startDirectTrip({ getState: () => state, dispatch: (action: AppAction) => { state = tripReducer(state as any, action) as any; }, route: r,
      request: { ...r, destination: '목적지', routeMode: 'DIRECT_BUS' as const, tripSupported: true as const },
      create: async () => { requests++; return response(); }, cancel: async () => {}, stopScan: async () => { throw stopError; } });
    return { result, state: () => state, requests: () => requests };
  };
  const offline = await run(Error('BLE_NOT_CONNECTED: 지팡이에 연결되어 있지 않습니다.'));
  await offline.result;
  assert.equal(offline.requests(), 1); assert.equal(offline.state().tripId, 'trip-direct'); assert.equal(offline.state().beaconScanActive, false);
  const failing = await run(Error('COMMAND_FAILED'));
  await assert.rejects(failing.result, /COMMAND_FAILED/);
  assert.equal(failing.requests(), 0); assert.equal(failing.state().beaconScanActive, true);
});

test('successful flight stays shared before React state commit', async () => {
  const r = route('200'); const state = { ...initialState, routeCandidates: [r], routeCandidatesExpiresAt: Date.now() + 60000 } as unknown as AppTripState;
  let requests = 0; const actions: AppAction[] = [];
  const deps = { getState: () => state, dispatch: (action: AppAction) => actions.push(action), route: r,
    request: { ...r, destination: '목적지', routeMode: 'DIRECT_BUS' as const, tripSupported: true as const },
    create: async () => { requests++; return response(); }, cancel: async () => {}, stopScan: async () => {} };
  await startDirectTrip(deps); await startDirectTrip(deps);
  assert.equal(requests, 1); assert.equal(actions.filter(a => a.type === 'START_TRIP').length, 1);
});
