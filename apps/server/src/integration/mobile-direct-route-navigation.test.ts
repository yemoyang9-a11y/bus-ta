import * as tripTransition from '../../../mobile/src/state/trip-transition.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { DEMO_ROUTE, type Route, type CreateTripResponse } from '@bus-ta/shared';
import { startDirectTrip } from '../../../mobile/src/state/direct-trip-selection.js';
import { initialState, tripReducer } from '../../../mobile/src/state/trip-reducer.js';
import { getTripNavigationTarget } from '../../../mobile/src/state/trip-transition.js';
import { dispatchRealtimeFunctionCall } from '../../../mobile/src/realtime/function-dispatcher.js';
import type { AppAction, AppTripState, RealtimeGuideContext } from '../../../mobile/src/realtime/types.js';

function app(routes: Route[], create: () => Promise<CreateTripResponse>) {
  let state = tripReducer(initialState, { type: 'SET_DESTINATION_AND_ROUTES', destination: '목적지', routes });
  let focused = true;
  const refs: any[] = []; let cursor = 0;
  let effects: (() => void)[] = [];
  const navigation: any[] = [];
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
    '../api/client': { apiClient: { trips: { create } } },
    '../state/direct-trip-selection': { startDirectTrip },
    '../state/transfer-journey': { canStartJourney: (r: Route) => r.routeMode === 'MULTIMODAL' && r.journeySupported },
    '../ble/bleManager': { stopBeaconScan: async () => {} },
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
  return { getState, dispatch, navigation, render, context, focus: (value: boolean) => { focused = value; },
    press: (route: Route) => render().props.renderItem({ item: route, index: 0 }).props.onPress(),
    start: (route: Route) => startDirectTrip({ getState, dispatch, route, request: { ...route, destination: "목적지", routeMode: "DIRECT_BUS", tripSupported: true }, create, stopScan: async () => {} }),
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
  const deferred = new Promise<void>(done => { release = done; });
  const create = async () => { requests++; await deferred; return response(); };
  const a = app([r], create);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(await create()), { status: 200 }));
  const first = voiceFirst ? voice(a, r) : a.press(r);
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
test('cancel and reselect creates a fresh trip; old response after reset cannot commit', async () => {
  const r = route('60'); let attempts = 0; let release!: () => void;
  const a = app([r], async () => { attempts++; if (attempts === 1) await new Promise<void>(done => { release = done; }); return response(`trip-${attempts}`); });
  const pending = a.start(r); await Promise.resolve();
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); release(); await assert.rejects(pending, /이전 응답/);
  await a.start(r); a.render(); assert.equal(a.getState().tripId, 'trip-2');
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); a.render(); await a.start(r); a.render();
  assert.equal(attempts, 3); assert.equal(a.getState().tripId, 'trip-3');
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
  const a = app([winner, other], async () => { requests++; return response('unexpected'); });
  t.mock.method(globalThis, 'fetch', async () => { requests++;
    await new Promise<void>(done => { release = done; }); return Response.json(response()); });
  const pending = voice(a, winner); await Promise.resolve(); await Promise.resolve();
  await a.press(other); release(); await pending; a.render();
  assert.equal(requests, 1); assert.equal(a.navigation.length, 1);
  assert.equal(a.navigation[0][1].selectedRoute, winner);
});

test('successful flight stays shared before React state commit', async () => {
  const r = route('200'); const state = { ...initialState, routeCandidates: [r], routeCandidatesExpiresAt: Date.now() + 60000 } as unknown as AppTripState;
  let requests = 0; const actions: AppAction[] = [];
  const deps = { getState: () => state, dispatch: (action: AppAction) => actions.push(action), route: r,
    request: { ...r, destination: '목적지', routeMode: 'DIRECT_BUS' as const, tripSupported: true as const },
    create: async () => { requests++; return response(); }, stopScan: async () => {} };
  await startDirectTrip(deps); await startDirectTrip(deps);
  assert.equal(requests, 1); assert.equal(actions.filter(a => a.type === 'START_TRIP').length, 1);
});
