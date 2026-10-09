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
  assert.equal(a.navigate[0][0], 'RouteList');
  // The missed route stays selectable so the user can wait for its next vehicle.
  assert.deepEqual(output(events).routes.map((r: any) => r.candidateId), [DEMO_ROUTE.candidateId, 2]);
  assert.equal(output(events).missedRouteCandidateId, DEMO_ROUTE.candidateId);
  assert.equal(events.filter(e => e.type === 'response.create').length, 1);
  assert.deepEqual(requests[0]!.body, { action: 'CANCEL' }); // reason is app-only.
  await call(a, 'create_trip', { candidateId: 2 }, 'next');
  assert.equal(a.getState().tripId, 'trip-B'); assert.equal(a.getState().selectedRoute?.routeNo, '504');
  a.focus(); assert.equal(a.navigate.at(-1)[0], 'Riding'); assert.equal(a.navigate.at(-1)[1].tripId, 'trip-B');
});
test('a new search during the trip cannot relabel a different route as the missed one', async t => {
  const a = setup();
  const lookalike = { ...DEMO_ROUTE, routeNo: '999' }; const third = { ...DEMO_ROUTE, candidateId: 3, routeNo: '777' };
  a.dispatch({ type: 'SET_DESTINATION_AND_ROUTES', destination: '다른 곳', routes: [lookalike, third] });
  t.mock.method(globalThis, 'fetch', async () => Response.json(ended));
  const pending = call(a); await until(a.waiting); a.focus();
  const result = output(await pending);
  assert.equal(result.missedRouteCandidateId, undefined);
  assert.deepEqual(result.routes.map((r: any) => r.routeNo), ['999', '777']);
});
test('explicit cancel without missed reason still omits the cancelled route', async t => {
  const a = setup(); t.mock.method(globalThis, 'fetch', async () => Response.json(ended));
  const pending = call(a, 'end_trip', { tripId: 'trip-A', action: 'CANCEL' }, 'explicit'); await until(a.waiting); a.focus();
  const result = output(await pending);
  assert.deepEqual(result.routes.map((r: any) => r.candidateId), [2]); assert.equal(result.missedRouteCandidateId, undefined);
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
test('only a first-person missed statement ends immediately; a passing bus is refreshed and confirmed first', () => {
  const update = createRealtimeSessionUpdateEvent();
  const { instructions } = update.session;
  assert.ok(instructions.includes(MISSED_BUS_POLICY_VERSION));
  assert.equal(MISSED_BUS_POLICY_VERSION, 'missed-bus-reselection-v3');
  const immediate = instructions.split('\n').find(line => line.startsWith('- 즉시 종료 예시'));
  assert.ok(immediate);
  for (const phrase of ['못 탔어', '버스 놓쳤어', '버스 못 탔어']) assert.ok(immediate.includes(phrase));
  assert.ok(!immediate.includes('지나갔어'));
  const passing = instructions.split('\n').find(line => line.includes('방금 버스 지나갔어'));
  assert.ok(passing);
  assert.match(passing, /종료하지 않는다/); assert.match(passing, /refreshArrivals=true/); assert.match(passing, /놓치셨나요/);
  // Status data cannot tell whether the passing bus was the user's, so always confirm; cancel only for direct trips.
  assert.match(passing, /^- 직행 WAITING_BUS에서/); assert.match(passing, /항상/); assert.match(passing, /UPSTREAM_ERROR/);
  assert.match(instructions, /단순 도착시간 질문은 get_trip_status/);
  assert.match(instructions, /환승 여정의 버스 구간[^\n]*refreshArrivals=true/);
  const end = update.session.tools.find(tool => tool.name === 'end_trip'); assert.ok(end);
  assert.ok('reason' in end.parameters.properties);
  assert.match(end.description, /지나갔다는 말만으로는 호출하지 않/);
  const status = update.session.tools.find(tool => tool.name === 'get_trip_status'); assert.ok(status);
  assert.match(JSON.stringify(status.parameters), /지나갔/);
});
test('status result instructions forbid chaining a cancel from the status result alone', async t => {
  const a = setup();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, tripId: 'trip-A', tripStatus: 'WAITING_BUS', bellStatus: 'NOT_REQUESTED', remainingStations: null, arrivals: [], arrivalStatus: 'NO_VEHICLE' }));
  const events = await call(a, 'get_trip_status', { tripId: 'trip-A', refreshArrivals: true });
  const response = events.find(e => e.type === 'response.create');
  assert.ok(response && response.type === 'response.create');
  const instructions = response.response?.instructions ?? '';
  assert.match(instructions, /이 결과만으로 end_trip을 호출하지 않는다/);
  assert.match(instructions, /환승 여정의 버스 구간이면 end_trip을 호출하지 않/);
  assert.match(instructions, /환승 여정이 아닌 직행 WAITING_BUS[^.]*end_trip\(reason=MISSED_BUS\)/);
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

test('missing destination focus still speaks the cancellation, without stale candidates', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = setup(); t.mock.method(globalThis, 'fetch', async () => Response.json(ended));
  const pending = call(a); await until(a.waiting); t.mock.timers.tick(5000);
  const events = await pending;
  assert.equal(a.getState().tripId, null);
  const responses = events.filter(e => e.type === 'response.create');
  assert.equal(responses.length, 1); assert.equal((responses[0] as any).candidateIdsToMark, undefined);
  assert.equal(output(events).success, true); assert.deepEqual(output(events).routes, []);
  assert.equal(output(events).missedRouteCandidateId, undefined);
});

for (const change of ['new-trip', 'expired']) test(`real Realtime session handles queued reselection speech: ${change}`, async t => {
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
  const responses = sent.filter(e => e.type === 'response.create');
  if (change === 'new-trip') { assert.equal(responses.length, 0); return; }
  // Expired candidates are not announced, but the cancellation itself is still spoken.
  assert.equal(responses.length, 1);
  assert.match(responses[0].response.instructions, /후보 유효시간이 지났/);
  assert.equal(a.getState().announcedCandidateIds.length, 0);
});
