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

test('existing WAITING_BUS allows next candidate audio and synchronized cards', async () => {
  const routes = [1, 2, 3, 4].map(id => route(`${id}`, id));
  const a = app(routes, async () => response()); await a.start(routes[0]!);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] });
  const s = sessionFor(a); await s.call('get_next_route_candidates');
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
  assert.deepEqual(a.getState().visibleRouteCandidates, routes.slice(2));
  assert.equal(a.getState().tripId, 'trip-direct');
});

test('existing WAITING_BUS allows new destination search audio without ending its trip', async t => {
  const a = app([route('15')], async () => response()); await a.start(a.getState().routeCandidates![0]!);
  const s = sessionFor(a); a.context.getCurrentLocation = () => ({ latitude: 0, longitude: 0 });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, destination: '새 목적지', routes: [route('34')] }));
  await s.call('search_routes', { destination: '새 목적지' });
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(a.getState().visibleRouteCandidates?.[0]?.routeNo, '34');
  assert.equal(a.getState().tripId, 'trip-direct');
});

test('duplicate journey candidate ID returns function output instead of throwing', async () => {
  const journey: Route = { ...route('mixed'), routeMode: 'MULTIMODAL', journeySupported: true, tripSupported: false,
    segments: [{ mode: 'WALK', startName: 'A', endName: 'B', lineNames: [], routeNumbers: [] },
      { mode: 'BUS', startName: 'B', endName: 'C', lineNames: [], routeNumbers: ['60'], busLeg: DEMO_ROUTE }] };
  const a = app([journey, { ...journey }], async () => response());
  const events = await dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done', call_id: 'duplicate-journey',
    name: 'start_journey', arguments: '{"candidateId":1}' }, a.context);
  assert.equal(functionOutput(events).success, false);
  assert.equal(a.getState().journeyRoute, null);
  assert.equal(events.filter(e => e.type === 'response.create').length, 1);
});

test('latest search survives earlier search state committing after latest request begins', async t => {
  const a = app([], async () => response()); a.context.getCurrentLocation = () => ({ latitude: 0, longitude: 0 });
  const deferred: AppAction[] = []; const dispatch = a.context.dispatchAppAction;
  a.context.dispatchAppAction = action => { if (action.type === 'SET_DESTINATION_AND_ROUTES') deferred.push(action); else dispatch(action); };
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    const destination = JSON.parse(options!.body as string).destination;
    if (destination === 'B') { entered(); await waiting; }
    return Response.json({ success: true, destination, routes: [route(destination === 'A' ? '15' : '34')] });
  });
  await dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done', call_id: 'A', name: 'search_routes', arguments: '{"destination":"A"}' }, a.context);
  const latest = dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done', call_id: 'B', name: 'search_routes', arguments: '{"destination":"B"}' }, a.context);
  await started; dispatch(deferred.shift()!); release();
  const events = await latest;
  for (const action of deferred) dispatch(action);
  assert.equal(functionOutput(events).success, true);
  assert.equal(a.getState().destination, 'B');
  sessionFor(a).send(events);
  assert.equal(a.render().props.data[0].routeNo, '34');
});

test('nonvoice cancellation preserves the current valid displayed batch and order', async () => {
  const routes = [1, 2, 3, 4].map(id => route(`${id}`, id));
  const a = app(routes, async () => response());
  a.dispatch({ type: 'SET_VISIBLE_ROUTE_CANDIDATES', routes: [routes[3]!, routes[2]!], searchRoutes: routes,
    generation: a.getState().directSelectionGeneration! });
  await a.start(routes[3]!);
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' });
  assert.deepEqual(a.render().props.data, [routes[3], routes[2]]);
});

test('server CANCELLED function path keeps the valid cards after resetting trip', async t => {
  const routes = [route('15'), route('34', 2)];
  const a = app(routes, async () => response()); await a.start(routes[0]!);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, tripId: 'trip-direct', tripStatus: 'CANCELLED' }));
  const events = await dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done', call_id: 'server-cancelled',
    name: 'get_trip_status', arguments: '{"tripId":"trip-direct"}' }, a.context);
  assert.equal(functionOutput(events).success, true);
  assert.equal(a.getState().tripId, null);
  assert.deepEqual(a.render().props.data, routes);
});

test('cancel_journey keeps the same candidate cards without introducing another announcement', async () => {
  const journey: Route = { ...route('mixed'), routeMode: 'MULTIMODAL', journeySupported: true, tripSupported: false,
    segments: [{ mode: 'WALK', startName: 'A', endName: 'B', lineNames: [], routeNumbers: [] },
      { mode: 'BUS', startName: 'B', endName: 'C', lineNames: [], routeNumbers: ['60'], busLeg: DEMO_ROUTE }] };
  const a = app([journey], async () => response()); a.dispatch({ type: 'START_JOURNEY', route: journey });
  const events = await dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done', call_id: 'journey-cancel',
    name: 'cancel_journey', arguments: '{}' }, a.context);
  assert.equal(functionOutput(events).success, true);
  assert.equal(a.getState().journeyRoute, null);
  assert.deepEqual(a.render().props.data, [journey]);
  assert.equal(events.filter(e => e.type === 'response.create').length, 1);
});

test('cancel reset never revives expired, exhausted or foreign candidate cards', () => {
  const routes = [route('15'), route('34', 2)]; const a = app(routes, async () => response());
  a.getState().visibleRouteCandidates = null;
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); assert.deepEqual(a.render().props.data, routes);
  a.getState().visibleRouteCandidates = [route('99', 5), routes[1]!];
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); assert.deepEqual(a.render().props.data, [routes[1]]);
  a.getState().visibleRouteCandidates = [];
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); assert.equal(a.render(), undefined);
  a.getState().visibleRouteCandidates = routes; a.getState().routeCandidatesExpiresAt = Date.now() - 1;
  a.dispatch({ type: 'RESET_TRIP_KEEP_SEARCH' }); assert.equal(a.render(), undefined);
});

test('queued candidate audio is discarded only after a new trip starts', async () => {
  const routes = [1, 2, 3, 4, 5].map(id => route(`${id}`, id));
  const a = app(routes, async () => response()); const s = sessionFor(a);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] });
  await s.call('get_next_route_candidates', {}, 'first'); await s.call('get_next_route_candidates', {}, 'queued');
  await a.start(routes[0]!); await s.done();
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
  assert.deepEqual(a.getState().announcedCandidateIds, [1, 2]);
});

test('running trip search waits for React candidate commit before requesting audio', async t => {
  const routes = [route('15')]; const a = app(routes, async () => response()); await a.start(routes[0]!);
  const s = sessionFor(a); a.context.getCurrentLocation = () => ({ latitude: 0, longitude: 0 });
  const actions: AppAction[] = []; const dispatch = a.context.dispatchAppAction;
  a.context.dispatchAppAction = action => { if (action.type === 'SET_DESTINATION_AND_ROUTES') actions.push(action); else dispatch(action); };
  let entered!: () => void;
  const enteredWait = new Promise<void>(resolve => { entered = resolve; });
  a.context.waitForSearchState = (candidates, requestId) => { entered(); return tripTransition.waitForSearchState(candidates, requestId); };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, destination: '새 목적지', routes: [route('34')] }));
  const pending = s.call('search_routes', { destination: '새 목적지' }); await enteredWait;
  assert.equal(s.sent.length, 0);
  dispatch(actions[0]!); tripTransition.confirmSearchState(a.getState()); await pending;
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(a.getState().visibleRouteCandidates?.[0]?.routeNo, '34');
});

test('new search invalidates pending state confirmation and its older audio', async t => {
  const a = app([], async () => response()); const s = sessionFor(a);
  a.context.getCurrentLocation = () => ({ latitude: 0, longitude: 0 });
  const actions: AppAction[] = []; const dispatch = a.context.dispatchAppAction;
  a.context.dispatchAppAction = action => { if (action.type === 'SET_DESTINATION_AND_ROUTES') actions.push(action); else dispatch(action); };
  const waiters: (() => void)[] = [];
  a.context.waitForSearchState = async () => { await new Promise<void>(resolve => { waiters.push(resolve); }); return true; };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    const destination = JSON.parse(options!.body as string).destination;
    return Response.json({ success: true, destination, routes: [route(destination === 'A' ? '15' : '34')] });
  });
  const first = s.call('search_routes', { destination: 'A' }, 'A');
  while (!waiters[0]) await new Promise(resolve => setImmediate(resolve));
  const second = s.call('search_routes', { destination: 'B' }, 'B');
  while (!waiters[1]) await new Promise(resolve => setImmediate(resolve));
  dispatch(actions[0]!); assert.equal(a.getState().destination, '목적지'); // stale A action is rejected at commit
  dispatch(actions[1]!); waiters[1]!(); await second; waiters[0]!(); await first;
  assert.equal(a.getState().destination, 'B');
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(a.render().props.data[0].routeNo, '34');
});

test('batched React commits of both searches use the latest actual selection generation', async t => {
  const a = app([], async () => response()); const s = sessionFor(a);
  a.context.getCurrentLocation = () => ({ latitude: 0, longitude: 0 });
  const actions: AppAction[] = []; const dispatch = a.context.dispatchAppAction;
  a.context.dispatchAppAction = action => { actions.push(action); };
  let waits = 0;
  a.context.waitForSearchState = (candidates, requestId) => { waits++; return tripTransition.waitForSearchState(candidates, requestId); };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    const destination = JSON.parse(options!.body as string).destination;
    return Response.json({ success: true, destination, routes: [route(destination === 'A' ? '15' : '34')] });
  });
  const first = s.call('search_routes', { destination: 'A' }, 'A');
  while (waits < 1) await new Promise(resolve => setImmediate(resolve));
  const second = s.call('search_routes', { destination: 'B' }, 'B');
  while (waits < 2) await new Promise(resolve => setImmediate(resolve));
  actions.splice(0).forEach(dispatch); tripTransition.confirmSearchState(a.getState());
  a.context.dispatchAppAction = dispatch;
  await Promise.all([first, second]);
  assert.equal(a.getState().destination, 'B');
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(a.render().props.data[0].routeNo, '34');
});

test('candidate instructions keep ordered route summaries without duplicated station lists or coordinates', async () => {
  const routes = [route('15'), route('34', 2)]; const a = app(routes, async () => response());
  const s = sessionFor(a); await s.call('get_next_route_candidates');
  const instructions = s.sent.find(e => e.type === 'response.create').response.instructions;
  assert.ok(instructions.indexOf('"candidateId":1') < instructions.indexOf('"candidateId":2'));
  assert.ok(instructions.includes(routes[0]!.boardingStation.stationName));
  assert.ok(!instructions.includes('"stationList"'));
  assert.ok(!instructions.includes('"latitude"'));
});

test('missed route with duplicate ID uses matching stations in speech and cards', async t => {
  const other = route('15', 1);
  const missed = { ...other, boardingStation: { ...other.boardingStation, stationName: '다른 승차 정류장' } };
  const a = app([missed], async () => response()); await a.start(missed);
  const routes = [other, missed, route('34', 2)];
  a.dispatch({ type: 'SET_DESTINATION_AND_ROUTES', destination: '목적지', routes });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, tripId: 'trip-direct', tripStatus: 'CANCELLED' }));
  const events = await dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done', call_id: 'duplicate-missed',
    name: 'end_trip', arguments: JSON.stringify({ tripId: 'trip-direct', action: 'CANCEL', reason: 'MISSED_BUS' }) }, a.context);
  sessionFor(a).send(events);
  assert.deepEqual(a.render().props.data.map((r: Route) => r.boardingStation), functionOutput(events).routes.map((r: Route) => r.boardingStation));
  assert.equal(a.render().props.data[0], missed);
});

function functionOutput(events: Awaited<ReturnType<typeof dispatchRealtimeFunctionCall>>) {
  const output = events.find(e => e.type === 'conversation.item.create');
  assert.ok(output?.type === 'conversation.item.create');
  return JSON.parse(output.item.output);
}

function sessionFor(a: ReturnType<typeof app>) {
  const path = new URL('../../../mobile/src/realtime/session.ts', import.meta.url);
  const exports: any = {}; const sent: any[] = [];
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { exports, require: createRequire(path), console, setTimeout, clearTimeout });
  const session = new exports.HaneumRealtimeSession(a.context);
  const transport = { send: (event: unknown) => sent.push(event) };
  session.transport = transport;
  return { session, sent, transport, send: (events: Awaited<ReturnType<typeof dispatchRealtimeFunctionCall>>) => {
    for (const event of events) session.send(event, transport);
  }, call: (name: string, args: unknown = {}, id = name) => session.handleServerEvent({ type: 'response.function_call_arguments.done',
    name, arguments: JSON.stringify(args), call_id: id }, transport),
  done: async () => { await session.handleServerEvent({ type: 'response.done', response: { status: 'completed' } }, transport); } };
}

test('next spoken candidate batch matches actual RouteList data and order', async () => {
  const routes = [route('15', 1), route('34', 2), route('15', 3), route('82', 4)];
  routes[2] = { ...routes[2]!, boardingStation: { ...routes[2]!.boardingStation, stationName: '다른 승차 정류장' } };
  const a = app(routes, async () => response());
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] });
  const events = await dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done',
    call_id: 'next-batch', name: 'get_next_route_candidates', arguments: '{}' }, a.context);
  const model = functionOutput(events);
  sessionFor(a).send(events);
  assert.deepEqual(a.render().props.data.map((r: Route) => r.candidateId), model.candidates.map((r: Route) => r.candidateId));
});

test('missed route comes first in both recovery speech and actual RouteList data', async t => {
  const routes = [route('34', 1), route('82', 2), route('15', 3)];
  const a = app(routes, async () => response()); await a.start(routes[2]!);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, tripId: 'trip-direct', tripStatus: 'CANCELLED' }));
  const events = await dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done',
    call_id: 'missed-batch', name: 'end_trip', arguments: JSON.stringify({ tripId: 'trip-direct', action: 'CANCEL', reason: 'MISSED_BUS' }) }, a.context);
  const model = functionOutput(events);
  sessionFor(a).send(events);
  assert.deepEqual(a.render().props.data.map((r: Route) => r.candidateId), model.routes.map((r: Route) => r.candidateId));
});

test('actual session paginates one remaining candidate, exhaustion and retains complete selectable search', async () => {
  const routes = [route('15', 1), route('34', 2), route('15', 3), route('82', 4), route('99', 5)];
  const a = app(routes, async () => response()); const s = sessionFor(a);
  assert.deepEqual(a.render().props.data, routes.slice(0, 2));
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] });
  await s.call('get_next_route_candidates');
  assert.deepEqual(a.render().props.data, routes.slice(2, 4));
  await s.done(); await s.call('get_next_route_candidates', {}, 'last');
  assert.deepEqual(a.render().props.data, routes.slice(4));
  await s.done(); await s.call('get_next_route_candidates', {}, 'exhausted');
  assert.equal(a.getState().visibleRouteCandidates?.length, 0);
  assert.equal(a.render(), undefined); // Actual screen renders its empty state, not stale cards.
  assert.equal(a.getState().routeCandidates, routes);
  const outputs = s.sent.filter(e => e.type === 'conversation.item.create').map(e => JSON.parse(e.item.output));
  assert.deepEqual(outputs.map(o => o.candidates.map((r: Route) => r.candidateId)), [[3, 4], [5], []]);
  assert.equal(outputs[2].exhausted, true);
});

test('concurrent next calls reserve queued batches and update screen only when each response starts', async () => {
  const routes = [1, 2, 3, 4, 5].map(id => route(`${id}`, id));
  const a = app(routes, async () => response()); const s = sessionFor(a);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] });
  await Promise.all([s.call('get_next_route_candidates', {}, 'one'), s.call('get_next_route_candidates', {}, 'two')]);
  assert.deepEqual(a.render().props.data, routes.slice(2, 4));
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
  await s.done(); assert.deepEqual(a.render().props.data, routes.slice(4));
  const instruction = s.sent.filter(e => e.type === 'response.create').at(-1).response.instructions;
  assert.ok(instruction.includes('"candidateId":5')); assert.ok(!instruction.includes('"candidateId":3'));
});

test('completed batch cannot repeat while React delays committing announced history', async () => {
  const routes = [1, 2, 3, 4, 5].map(id => route(`${id}`, id));
  const a = app(routes, async () => response()); const s = sessionFor(a);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] });
  const marks: AppAction[] = []; const dispatch = a.context.dispatchAppAction;
  a.context.dispatchAppAction = action => { if (action.type === 'MARK_CANDIDATES_ANNOUNCED') marks.push(action); else dispatch(action); };
  await s.call('get_next_route_candidates', {}, 'first');
  await s.done();
  assert.deepEqual(a.getState().announcedCandidateIds, [1, 2]);
  await s.call('get_next_route_candidates', {}, 'second'); assert.deepEqual(a.render().props.data, routes.slice(4));
  a.dispatch({ type: 'SET_DESTINATION_AND_ROUTES', destination: '새 검색', routes: [route('99', 1)] });
  for (const mark of marks) dispatch(mark);
  assert.deepEqual(a.getState().announcedCandidateIds, []);
});

test('initial search retains all originals but gives voice and screen the same first two', async t => {
  const routes = [1, 2, 3, 4].map(id => route(`${id}`, id));
  const a = app([], async () => response()); const s = sessionFor(a);
  a.context.getCurrentLocation = () => ({ latitude: 0, longitude: 0 });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, destination: '목적지', routes }));
  await s.call('search_routes', { destination: '목적지' });
  const output = JSON.parse(s.sent.find(e => e.type === 'conversation.item.create').item.output);
  assert.deepEqual(output.routes.map((r: Route) => r.candidateId), [1, 2]);
  assert.deepEqual(a.render().props.data.map((r: Route) => r.candidateId), [1, 2]);
  assert.equal(a.getState().routeCandidates?.length, 4);
});

test('search waits for real candidate state commit and focused screen before requesting candidate audio', async t => {
  const a = app([], async () => response()); const s = sessionFor(a);
  const actions: AppAction[] = []; const originalDispatch = a.context.dispatchAppAction;
  a.context.dispatchAppAction = action => { if (action.type === 'SET_DESTINATION_AND_ROUTES') actions.push(action); else originalDispatch(action); };
  let ready!: () => void; let entered!: () => void;
  const committed = new Promise<void>(resolve => { ready = resolve; }); const waiting = new Promise<void>(resolve => { entered = resolve; });
  a.context.waitForRouteSelection = async (generation, candidates) => {
    assert.equal(generation, (a.getState().directSelectionGeneration ?? 0) + 1);
    assert.equal(candidates, (actions[0] as any).routes); entered(); await committed; return true;
  };
  a.context.getCurrentLocation = () => ({ latitude: 0, longitude: 0 });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, destination: '목적지', routes: [route('34')] }));
  const pending = s.call('search_routes', { destination: '목적지' }); await waiting;
  assert.equal(s.sent.length, 0); originalDispatch(actions[0]!); ready(); await pending;
  assert.equal(a.render().props.data[0].routeNo, '34');
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
});

test('failed candidate speech remains unannounced and can retry the same batch', async () => {
  const routes = [1, 2, 3].map(id => route(`${id}`, id));
  const a = app(routes, async () => response()); const s = sessionFor(a);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] }); await s.call('get_next_route_candidates', {}, 'first');
  await s.session.handleServerEvent({ type: 'response.done', response: { status: 'failed' } }, s.transport);
  await s.call('get_next_route_candidates', {}, 'retry');
  assert.deepEqual(a.render().props.data, routes.slice(2)); assert.deepEqual(a.getState().announcedCandidateIds, [1, 2]);
});

test('expired queued batch clears visible cards without announcing its stale candidates', async () => {
  const routes = [1, 2, 3, 4, 5].map(id => route(`${id}`, id));
  const a = app(routes, async () => response()); const s = sessionFor(a);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] });
  await s.call('get_next_route_candidates', {}, 'one'); await s.call('get_next_route_candidates', {}, 'two');
  a.getState().routeCandidatesExpiresAt = Date.now() - 1; await s.done();
  assert.equal(a.getState().visibleRouteCandidates?.length, 0);
  assert.match(s.sent.filter(e => e.type === 'response.create').at(-1).response.instructions, /만료/);
});

test('new search discards old queued batches and rejects stale displayed candidate objects', async () => {
  const routes = [1, 2, 3, 4, 5].map(id => route('15', id));
  const a = app(routes, async () => response()); const s = sessionFor(a);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] });
  await s.call('get_next_route_candidates', {}, 'one'); await s.call('get_next_route_candidates', {}, 'two');
  const fresh = [route('34', 1), route('99', 2)];
  a.dispatch({ type: 'SET_DESTINATION_AND_ROUTES', destination: '새 목적지', routes: fresh });
  await s.done();
  assert.deepEqual(a.render().props.data, fresh); assert.deepEqual(a.getState().announcedCandidateIds, []);
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
  await assert.rejects(a.start(routes[2]!), /만료/);
  a.dispatch({ type: 'RESET_TRIP' }); assert.equal(a.getState().visibleRouteCandidates, null);
});

test('touching the new batch uses the exact same-number candidate and stations', async () => {
  const first = route('15', 1); const other = { ...route('15', 3), boardingStation: { ...first.boardingStation, stationName: '다른 정류장' } };
  const a = app([first, route('34', 2), other], async () => response()); const s = sessionFor(a);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] }); await s.call('get_next_route_candidates');
  assert.equal(a.render().props.data[0], other); await a.press(other); a.render();
  assert.equal(a.getState().selectedRoute, other); assert.equal(a.navigation.at(-1)[0], 'Riding');
});

test('voice selection of the displayed same-number candidate submits its exact ID and stations', async t => {
  const original = route('15', 1); const selected = { ...route('15', 3), destinationStation: { ...original.destinationStation, stationName: '다른 하차 정류장' } };
  const a = app([original, route('34', 2), selected], async () => response()); const s = sessionFor(a);
  a.dispatch({ type: 'MARK_CANDIDATES_ANNOUNCED', candidateIds: [1, 2] }); await s.call('get_next_route_candidates');
  let submitted: any;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => { submitted = JSON.parse(options!.body as string); return Response.json(response()); });
  await voice(a, selected); a.render();
  assert.equal(submitted.candidateId, 3); assert.equal(submitted.destinationStation.stationName, '다른 하차 정류장');
  assert.equal(a.getState().selectedRoute, selected); assert.equal(a.navigation.at(-1)[0], 'Riding');
});

test('reused candidate ID and route number with different stations is not labelled as the missed route', async t => {
  const old = route('15', 1); const a = app([old], async () => response()); await a.start(old);
  const changed = { ...old, boardingStation: { ...old.boardingStation, stationName: '새 승차 정류장' } };
  a.dispatch({ type: 'SET_DESTINATION_AND_ROUTES', destination: '새 목적지', routes: [changed, route('99', 2)] });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, tripId: 'trip-direct', tripStatus: 'CANCELLED' }));
  const events = await dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done', call_id: 'cancel-new-search',
    name: 'end_trip', arguments: JSON.stringify({ tripId: 'trip-direct', action: 'CANCEL', reason: 'MISSED_BUS' }) }, a.context);
  assert.equal(functionOutput(events).missedRouteCandidateId, undefined);
});

test('late search API response cannot overwrite newer search candidates or create stale speech', async t => {
  const a = app([route('15')], async () => response()); const s = sessionFor(a);
  a.context.getCurrentLocation = () => ({ latitude: 0, longitude: 0 });
  let release!: () => void; let started!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
  const old = route('15'), fresh = route('99');
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    const destination = JSON.parse(options!.body as string).destination;
    if (destination === '이전 검색') { started(); await pending; }
    return Response.json({ success: true, destination, routes: [destination === '이전 검색' ? old : fresh] });
  });
  const delayed = s.call('search_routes', { destination: '이전 검색' }, 'old'); await entered;
  await s.call('search_routes', { destination: '새 검색' }, 'fresh'); release(); await delayed;
  assert.equal(a.getState().destination, '새 검색'); assert.equal(a.render().props.data[0].routeNo, '99');
  assert.equal(s.sent.filter(e => e.type === 'response.create').length, 1);
});

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
