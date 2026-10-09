import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DEMO_ROUTE } from '@bus-ta/shared';
import { initialState, tripReducer } from '../../../mobile/src/state/trip-reducer.js';
import { waitForRouteSelection, confirmRouteSelectionScreen } from '../../../mobile/src/state/trip-transition.js';
import { dispatchRealtimeFunctionCall } from '../../../mobile/src/realtime/function-dispatcher.js';
import { createRealtimeSessionUpdateEvent, MISSED_BUS_POLICY_VERSION } from '../../../mobile/src/realtime/guide.js';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { AppAction, AppTripState, RealtimeClientEvent, RealtimeGuideContext } from '../../../mobile/src/realtime/types.js';

function setup() {
  const other = { ...DEMO_ROUTE, candidateId: 2, routeNo: '504' };
  let state = tripReducer(initialState, { type: 'SET_DESTINATION_AND_ROUTES', destination: '목적지', routes: [DEMO_ROUTE, other] });
  state = tripReducer(state, { type: 'SELECT_ROUTE', route: DEMO_ROUTE });
  state = tripReducer(state, { type: 'START_TRIP', tripId: 'trip-A' });
  const getState = () => state as unknown as AppTripState;
  const dispatch = (action: AppAction) => { state = tripReducer(state, action); };
  let waiting = false;
  const context: RealtimeGuideContext = { getAppState: getState, dispatchAppAction: dispatch,
    getCurrentLocation: () => undefined, refreshCurrentLocation: async () => {},
    waitForRouteSelection: generation => { waiting = true; return waitForRouteSelection(getState(), generation); } };
  const navigate: any[] = [];
  const focus = () => {
    const source = readFileSync(new URL('../../../mobile/src/screens/RidingScreen.js', import.meta.url), 'utf8');
    const start = source.indexOf('useEffect(() => {', source.indexOf('bellHandledRef.current = false'));
    const body = source.slice(start + 'useEffect(() => {'.length, source.indexOf('}, [', start));
    new Function('state', 'tripId', 'stoppedRef', 'isFocused', 'navigation', 'trackingError', body)(
      state, 'trip-A', { current: false }, true, { navigate: (...args: any[]) => navigate.push(args) }, null);
    // Execute the actual destination-screen effect, with only hook values stubbed.
    const target = navigate.at(-1)?.[0];
    if (target === 'RouteList') {
      const src = readFileSync(new URL('../../../mobile/src/screens/RouteListScreen.js', import.meta.url), 'utf8');
      const from = src.indexOf('useEffect(() => {');
      new Function('state', 'isFocused', 'navigatedRef', 'navigation', 'confirmRouteSelectionScreen',
        src.slice(from + 'useEffect(() => {'.length, src.indexOf('}, [', from)))(state, true, { current: null },
          { navigate: (...args: any[]) => navigate.push(args) }, confirmRouteSelectionScreen);
    } else if (target === 'Main') confirmRouteSelectionScreen(getState());
  };
  return { getState, dispatch, context, other, navigate, focus, waiting: () => waiting };
}
function call(a: ReturnType<typeof setup>, name = 'end_trip', args: unknown = { tripId: 'trip-A', action: 'CANCEL', reason: 'MISSED_BUS' }, id = 'missed') {
  return dispatchRealtimeFunctionCall({ type: 'response.function_call_arguments.done', call_id: id, name: name as 'end_trip', arguments: JSON.stringify(args) }, a.context);
}
function output(events: RealtimeClientEvent[]) {
  const event = events.find(e => e.type === 'conversation.item.create');
  assert.ok(event && event.type === 'conversation.item.create'); return JSON.parse(event.item.output);
}
async function until(predicate: () => boolean) { for (let i = 0; i < 30 && !predicate(); i++) await new Promise<void>(done => setImmediate(done)); assert.ok(predicate()); }
const ended = { success: true, tripId: 'trip-A', tripStatus: 'CANCELLED', message: '취소', timestamp: 'now' };

test('missed waiting bus ends successfully, waits for focused RouteList, reannounces and voice selects new trip', async t => {
  const a = setup(); const requests: { method: string; body: any }[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => { requests.push({ method: init!.method!, body: JSON.parse(init!.body as string) });
    return Response.json(init!.method === 'PATCH' ? ended : { success: true, tripId: 'trip-B', arrivals: [], routeNo: a.other.routeNo }); });
  let finished = false; const pending = call(a).then(events => { finished = true; return events; });
  await until(a.waiting); assert.equal(finished, false); assert.equal(a.getState().tripId, null);
  assert.equal(a.getState().selectedRoute, null); assert.equal(a.getState().destination, '목적지');
  a.focus(); const events = await pending;
  assert.equal(a.navigate[0][0], 'RouteList'); assert.equal(output(events).routes[0].candidateId, 2);
  assert.equal(events.filter(e => e.type === 'response.create').length, 1);
  assert.deepEqual(requests[0]!.body, { action: 'CANCEL' }); // reason is app-only.
  await call(a, 'create_trip', { candidateId: 2 }, 'next');
  assert.equal(a.getState().tripId, 'trip-B'); assert.equal(a.getState().selectedRoute?.routeNo, '504');
  a.focus(); assert.equal(a.navigate.at(-1)[0], 'Riding'); assert.equal(a.navigate.at(-1)[1].tripId, 'trip-B');
});
test('end API failure keeps waiting trip, selection and destination; retry is allowed', async t => {
  const a = setup(); let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ success: false, errorCode: 'DB_ERROR', message: '실패' }, { status: 500 }); });
  assert.equal(output(await call(a)).success, false); assert.equal(output(await call(a, 'end_trip', undefined, 'retry')).success, false);
  assert.equal(requests, 2); assert.equal(a.getState().tripId, 'trip-A'); assert.ok(a.getState().selectedRoute);
  assert.equal(a.navigate.length, 0); assert.equal(a.waiting(), false);
});
test('duplicate end intents use one API and one reannouncement', async t => {
  const a = setup(); let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json(ended); });
  const one = call(a); const two = call(a, 'end_trip', { tripId: 'trip-A', action: 'CANCEL' }, 'duplicate');
  await until(a.waiting); a.focus(); const events = (await Promise.all([one, two])).flat();
  assert.equal(requests, 1); assert.equal(events.filter(e => e.type === 'response.create').length, 1);
});
test('plain refresh query does not end or reset the trip and remains a GET', async t => {
  const a = setup(); let url = ''; let method = '';
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => { url = String(input); method = init?.method ?? 'GET';
    return Response.json({ success: true, tripId: 'trip-A', tripStatus: 'WAITING_BUS', bellStatus: 'NOT_REQUESTED', remainingStations: null, arrivals: [], arrivalStatus: 'NO_VEHICLE' }); });
  await call(a, 'get_trip_status', { tripId: 'trip-A', refreshArrivals: true });
  assert.equal(method, 'GET'); assert.match(url, /refreshArrivals=true/); assert.equal(a.getState().tripId, 'trip-A');
});
for (const condition of ['expired', 'empty']) test(`missing/expired candidates return Main and request new search: ${condition}`, async t => {
  const a = setup(); const state = a.getState();
  if (condition === 'expired') state.routeCandidatesExpiresAt = Date.now() - 1; else state.routeCandidates = [];
  t.mock.method(globalThis, 'fetch', async () => Response.json(ended));
  const pending = call(a); await until(a.waiting); a.focus(); const events = await pending;
  assert.equal(a.navigate[0][0], 'Main'); assert.equal(output(events).routes.length, 0);
  assert.ok(events.some(e => e.type === 'response.create'));
});
test('late end success and late status cannot restore or clear replacement trip', async t => {
  const a = setup(); let release!: () => void;
  t.mock.method(globalThis, 'fetch', async () => { await new Promise<void>(done => { release = done; }); return Response.json(ended); });
  const pending = call(a); await until(() => Boolean(release));
  a.dispatch({ type: 'START_TRIP', tripId: 'trip-B' }); release();
  assert.equal(output(await pending).success, false); assert.equal(a.getState().tripId, 'trip-B');
  a.dispatch({ type: 'UPDATE_TRIP_STATUS', status: { tripId: 'trip-A', tripStatus: 'WAITING_BUS' } });
  assert.equal(a.getState().tripId, 'trip-B'); assert.equal(a.navigate.length, 0);
});
test('new selection while awaiting screen suppresses stale candidate response', async t => {
  const a = setup(); t.mock.method(globalThis, 'fetch', async () => Response.json(ended));
  const pending = call(a); await until(a.waiting);
  a.focus(); a.dispatch({ type: 'START_TRIP', tripId: 'trip-B' });
  const events = await pending; assert.equal(events.filter(e => e.type === 'response.create').length, 0);
});
for (const condition of ['boarded', 'journey']) test(`missed-bus guard does not affect ${condition}`, async t => {
  const a = setup(); let requests = 0;
  if (condition === 'boarded') a.dispatch({ type: 'CONFIRM_BOARDING', tripId: 'trip-A', tripStatus: 'ON_BUS', boardingMethod: 'USER_CONFIRMED', boardingConfirmedAt: 'now' });
  else a.getState().journeyRoute = DEMO_ROUTE;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw Error('must not call'); });
  assert.equal(output(await call(a)).success, false); assert.equal(requests, 0); assert.equal(a.getState().tripId, 'trip-A');
});
test('semantic tool instructions distinguish missed bus from arrival refresh without text matching', () => {
  const update = createRealtimeSessionUpdateEvent();
  assert.match(update.session.instructions, /특정 문구에 한정하지 않고 end_trip/);
  assert.match(update.session.instructions, /단순 도착시간 질문은 get_trip_status/);
  const end = update.session.tools.find(tool => tool.name === 'end_trip'); assert.ok(end);
  assert.ok('reason' in end.parameters.properties);
  assert.ok(update.session.instructions.includes(MISSED_BUS_POLICY_VERSION));
  for (const phrase of ['못 탔어', '버스 놓쳤어', '버스 못 탔어', '방금 버스 지나갔어', '버스 언제 와?', '도착시간 다시 알려줘']) {
    assert.ok(update.session.instructions.includes(phrase));
  }
  assert.match(end.description, /종료 요청을 따로 말하지 않아도/);
});

test('actual session sends current semantic policy and distinguishes acknowledged, old and missing policy', async () => {
  const a = setup(); const diagnostics: any[] = []; const sent: any[] = [];
  const sessionPath = new URL('../../../mobile/src/realtime/session.ts', import.meta.url);
  const realRequire = createRequire(sessionPath); const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(sessionPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: (name: string) => name === './voice-route-diagnostic'
    ? { logVoiceRouteDiagnostic: (stage: string, fields: unknown) => diagnostics.push({ stage, fields }) }
    : realRequire(name), console, setTimeout, clearTimeout });
  const session = new exports.HaneumRealtimeSession(a.context);
  const transport = { send: (event: unknown) => sent.push(event) }; session.transport = transport;
  session.sendSessionUpdate(transport);
  assert.ok(sent[0].session.instructions.includes(MISSED_BUS_POLICY_VERSION));
  for (const instructions of [sent[0].session.instructions, 'old instructions', undefined]) {
    await session.handleServerEvent({ type: 'session.updated', session: { instructions } }, transport);
  }
  assert.deepEqual(diagnostics.filter(d => d.stage === 'policy_ack').map(d => d.fields.policy),
    ['confirmed', 'different', 'unavailable']);
});

test('missing destination focus expires without generating stale candidate audio', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = setup(); t.mock.method(globalThis, 'fetch', async () => Response.json(ended));
  const pending = call(a); await until(a.waiting); t.mock.timers.tick(5000);
  const events = await pending;
  assert.equal(a.getState().tripId, null); assert.equal(events.filter(e => e.type === 'response.create').length, 0);
});

for (const change of ['new-trip', 'expired']) test(`real Realtime session drops queued reselection speech: ${change}`, async t => {
  const a = setup(); const sent: any[] = [];
  // Load the actual session implementation without importing the native WebRTC
  // declarations into the server compiler. Transport is the only IO boundary.
  const sessionPath = new URL('../../../mobile/src/realtime/session.ts', import.meta.url);
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(sessionPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: createRequire(sessionPath), console, setTimeout, clearTimeout });
  const session = new exports.HaneumRealtimeSession(a.context);
  const transport = { send: (event: unknown) => sent.push(event) };
  (session as unknown as { transport: typeof transport }).transport = transport;
  await session.handleServerEvent({ type: 'response.created', response: { id: 'speaking' } }, transport);
  t.mock.method(globalThis, 'fetch', async () => Response.json(ended));
  const pending = session.handleServerEvent({ type: 'response.function_call_arguments.done', call_id: 'queued-end',
    name: 'end_trip', arguments: JSON.stringify({ tripId: 'trip-A', action: 'CANCEL', reason: 'MISSED_BUS' }) }, transport);
  await until(a.waiting); a.focus(); await pending;
  if (change === 'new-trip') a.dispatch({ type: 'START_TRIP', tripId: 'trip-B' });
  else a.getState().routeCandidatesExpiresAt = Date.now() - 1;
  await session.handleServerEvent({ type: 'response.done', response: { id: 'speaking', status: 'completed' } }, transport);
  await session.handleServerEvent({ type: 'output_audio_buffer.stopped', response_id: 'speaking' }, transport);
  assert.equal(sent.filter(e => e.type === 'response.create').length, 0);
});
