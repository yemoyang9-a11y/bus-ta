import * as tripTracking from '../../../mobile/src/realtime/trip-tracking.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createBellStopSession } from '../../../mobile/src/ble/bell-stop-session.js';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// RN 렌더러 대신 hook 수명 경계만 대체하고 실제 화면과 세션 코드를 실행한다.
function setup() {
  let bellConnected = true;
  let connection: Promise<unknown> | undefined;
  let connectionCheck: Promise<boolean> | undefined;
  const pendingEffects: Array<() => void> = [];
  const slots: any[] = [];
  let cursor = 0;
  let effect: () => () => void;
  let cleanup: (() => void) | undefined;
  let connected = true;
  let currentTripId: string | null = 'A';
  let currentStatus='NEAR_DESTINATION';
  let homePress:()=>Promise<void>;
  let endReject=false;
  let postPromise:Promise<void>|null=null;
  let postFailures=0;
  let storedBellStatus: string | undefined;
  let fetchedStatus: Record<string, unknown> | undefined;
  let getFailure = false;
  let getPromise: Promise<void> | undefined;
  const notified: unknown[] = [];
  const speech:string[]=[];
  const navigations:string[]=[];
  const dispatched:any[]=[];
  let endResolve:((result:any)=>void)|null=null;
  let endPromise:Promise<any>|null=null;
  let resolveWrite!: () => void;
  let rejectWrite!: (reason: Error) => void;
  const pendingWrite = new Promise<void>((resolve, reject) => { resolveWrite = resolve; rejectWrite = reject; });
  const callbacks: Array<(result: { result: string }) => void> = [];
  const calls = { connects: 0, checks: 0, sends: 0, removes: 0, results: [] as string[], states: [] as string[], dispatches: 0, ends:0, posts:0 };
  const React = {
    createElement: (_type:any,props:any) => {if(props?.onPress)homePress=props.onPress;return null;},
    useEffect(callback: () => void, deps: unknown[]) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        slots[index] = { deps };
        pendingEffects.push(callback);
      }
    },
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
    exports, console, setTimeout:(callback:()=>void,ms:number)=>{ if(ms===1000 || ms===2000){queueMicrotask(callback);return 1;}return setTimeout(callback,ms);}, clearTimeout,
    require: (name: string) => {
      if (name === 'react') return React;
      if (name === 'react-native') return { StyleSheet: { create: (value: unknown) => value } };
      if (name === 'expo-speech') return { speak:(message:string)=>speech.push(message), stop() {} };
      if (name === '@react-navigation/native') return { useFocusEffect: (next: typeof effect) => { effect = next; }, useIsFocused: () => true };
      if (name === '../realtime/trip-tracking') return tripTracking;
      if (name === '../ble/bell-stop-session') return { createBellStopSession };
      if (name === '../state/TripContext') return { useTrip: () => ({
        state: { tripId: currentTripId, tripStatus: currentStatus, targetBeaconId: 'BUS_A', bleIsMock: false },
        dispatch: (action:any) => { calls.dispatches++;dispatched.push(action);if(action.type==='RESET_TRIP')currentTripId=null; },
      }) };
      if (name === '../realtime/RealtimeProvider') return { useRealtime: () => ({ isConnected: connected, session: { notifyStatusChange: (status: unknown) => notified.push(status) } }) };
      if (name === '../api/client') return { ApiError: class extends Error {}, apiClient: { trips: {
        bell: { result: async (tripId: string, body: { result: string }) => {calls.posts++; if(postFailures-- > 0)throw Error('network');if(postPromise)await postPromise; calls.results.push(tripId); const alreadyRecorded = storedBellStatus !== undefined; storedBellStatus ??= body.result; return { success: true, resultCode: alreadyRecorded ? 'ALREADY_RECORDED' : 'RECORDED', bellStatus: storedBellStatus }; } },
        end:async()=>{calls.ends++;if(endReject)throw Error('network');return endPromise ?? {success:true,tripId:currentTripId};},
        getStatus: async () => { if (getPromise) await getPromise; if (getFailure) throw Error('status unavailable'); return fetchedStatus ?? { tripStatus: currentStatus, bellStatus: storedBellStatus }; },
      } } };
      if (name === '../ble/bleManager') return {
        isBellConnected: async () => { calls.checks++; return connectionCheck ?? bellConnected; },
        connectBell: async () => { calls.connects++; await connection; bellConnected = true; return {}; },
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
    calls, callbacks, resolveWrite, speech, navigations, dispatched, notified,
    storedResult: (status: string) => { storedBellStatus = status; },
    statusResponse: (status: Record<string, unknown>) => { fetchedStatus = status; },
    failGet: () => { getFailure = true; },
    deferGet: (promise: Promise<void>) => { getPromise = promise; },
    rejectWrite: () => rejectWrite(new Error('write failed')),
    deferConnection: (promise: Promise<unknown>) => { bellConnected = false; connection = promise; },
    deferConnectionCheck: (promise: Promise<boolean>) => { connectionCheck = promise; },
    home:()=>homePress(), failEnd:()=>{endReject=true;},
    waitEnd:()=>{endPromise=new Promise(r=>{endResolve=r;});},finishEnd:()=>endResolve?.({success:true}),
    deferPost:(promise:Promise<void>)=>{postPromise=promise;},failPosts:(count:number)=>{postFailures=count;},
    completeTrip:()=>{currentStatus='TRIP_DONE';},
    render(tripId = 'A', realtimeConnected = true) {
      cursor = 0;
      connected = realtimeConnected;
      currentTripId = tripId;
      const previous = effect;
      exports.default({ route: { params: { tripId, bellRequestId: `bell-${tripId}`, command: 'STOP_REQUEST' } },navigation:{navigate:(name:string)=>navigations.push(name)} });
      if (effect! !== previous || !cleanup) {
        cleanup?.();
        cleanup = effect!();
      }
      for (const run of pendingEffects.splice(0)) run();
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


test('Alight 홈은 서버 end 성공까지 운행을 보존하고 실패하면 종료를 주장하지 않는다',async()=>{
 const a=setup();a.render();await flush();a.failEnd();await a.home();assert.equal(a.calls.ends,1);assert.equal(a.calls.dispatches,0);assert.deepEqual(a.navigations,[]);a.blur();
 const b=setup();b.render();await flush();b.waitEnd();const home=b.home();await flush();assert.equal(b.calls.dispatches,0);assert.deepEqual(b.navigations,[]);
 b.finishEnd();await home;assert.equal(b.dispatched.at(-1).type,'RESET_TRIP');assert.deepEqual(b.navigations,['Main']);b.blur();
});

test('GPS 완료보다 늦은 벨 저장은 상태 회귀/벨 성공 음성을 만들지 않는다',async()=>{
 const a=setup();let resolve!:()=>void;a.deferPost(new Promise(r=>resolve=r));a.render('A',false);await flush();a.callbacks[0]!({result:'SUCCESS'});await flush();
 a.completeTrip();a.render('A',false);resolve();await flush();assert.deepEqual(a.calls.results,['A']);assert.equal(a.calls.dispatches,0);
 assert.equal(a.speech.filter(text=>text==='하차벨이 정상적으로 작동했습니다.').length,0);a.blur();
});

test('벨 결과 저장 재시도는 물리 STOP_REQUEST를 다시 보내지 않는다',async()=>{
 const a=setup();a.failPosts(2);a.render();await flush();a.callbacks[0]!({result:'SUCCESS'});await flush();
 assert.equal(a.calls.posts,3);assert.equal(a.calls.sends,1);assert.deepEqual(a.calls.results,['A']);a.blur();
});


test('이미 TRIP_DONE인 Alight focus는 연결 확인/연결/STOP/실패 저장을 시작하지 않는다', async () => {
  const screen = setup(); screen.completeTrip(); screen.render(); await flush();
  assert.equal(screen.calls.checks, 0); assert.equal(screen.calls.connects, 0);
  assert.equal(screen.calls.sends, 0); assert.equal(screen.calls.posts, 0); screen.blur();
});

test('연결 상태 확인 중 완료되면 늦은 false 응답도 새 연결을 만들지 않는다', async () => {
  const screen = setup(); let resolve!: (value: boolean) => void;
  screen.deferConnectionCheck(new Promise(r => { resolve = r; }));
  screen.render(); await flush(); screen.completeTrip(); screen.render();
  resolve(false); await flush();
  assert.equal(screen.calls.connects, 0); assert.equal(screen.calls.sends, 0);
  assert.equal(screen.calls.posts, 0); screen.blur();
});

test('Alight 연결 대기 중 GPS 완료 뒤 늦은 연결은 새 STOP을 보내지 않는다', async () => {
  const screen = setup(); let resolve!: () => void;
  screen.deferConnection(new Promise<void>(r => { resolve = r; }));
  screen.render(); await flush(); assert.equal(screen.calls.connects, 1);
  screen.completeTrip(); screen.render(); resolve(); await flush();
  assert.equal(screen.calls.sends, 0); assert.equal(screen.calls.posts, 0); screen.blur();
});

test('전송 중 완료 뒤 write 실패는 재연결/STOP 재전송을 시작하지 않는다', async () => {
  const screen = setup(); screen.render(); await flush(); assert.equal(screen.calls.sends, 1);
  const checks = screen.calls.checks;
  screen.completeTrip(); screen.render(); screen.rejectWrite(); await flush();
  assert.equal(screen.calls.checks, checks); assert.equal(screen.calls.connects, 0);
  assert.equal(screen.calls.sends, 1); screen.blur();
});

test('완료 전에 시작한 write의 늦은 성공 Notify와 저장은 완료 후에도 보존한다', async () => {
  const screen = setup(); screen.render('A', false); await flush();
  screen.completeTrip(); screen.render('A', false); screen.resolveWrite(); await flush();
  screen.callbacks[0]!({ result: 'SUCCESS' }); await flush();
  assert.equal(screen.calls.sends, 1); assert.deepEqual(screen.calls.results, ['A']);
  assert.equal(screen.calls.dispatches, 0);
  assert.equal(screen.speech.filter(text => text === '하차벨이 정상적으로 작동했습니다.').length, 0);
  screen.blur();
});


test('첫 write 실패 뒤 재연결 대기 중 완료되어도 두 번째 STOP은 보내지 않는다', async () => {
  const screen = setup(); screen.render(); await flush();
  let resolve!: () => void;
  screen.deferConnection(new Promise<void>(r => { resolve = r; }));
  screen.rejectWrite(); await flush(); assert.equal(screen.calls.connects, 1);
  screen.completeTrip(); screen.render(); resolve(); await flush();
  assert.equal(screen.calls.sends, 1); screen.blur();
});

test('완료 전에 시작한 write의 ACK보다 먼저 온 실제 Notify도 완료 후 저장한다', async () => {
  const screen = setup(); screen.render(); await flush();
  screen.completeTrip(); screen.render(); screen.callbacks[0]!({ result: 'SUCCESS' }); await flush();
  assert.deepEqual(screen.calls.results, ['A']); assert.equal(screen.calls.dispatches, 0);
  screen.resolveWrite(); await flush(); assert.equal(screen.calls.sends, 1); screen.blur();
});

for (const [stored, physical, expected] of [
  ['SUCCESS', 'FAIL', 'success'],
  ['FAIL', 'SUCCESS', 'fail'],
] as const) {
  test(`최초 ${stored}와 물리 ${physical}가 충돌하면 UI와 로컬 TTS는 서버 ${stored}만 확정한다`, async () => {
    const screen = setup(); screen.storedResult(stored); screen.render('A', false); await flush();
    screen.callbacks[0]!({ result: physical }); await flush();
    assert.equal(screen.calls.states.at(-1), expected);
    assert.equal(screen.calls.states.includes(expected === 'success' ? 'fail' : 'success'), false);
    assert.equal(screen.speech.at(-1), expected === 'success' ? '하차벨이 정상적으로 작동했습니다.' : '하차벨 응답을 받지 못했습니다. 기사님께 직접 말씀해주세요.');
    screen.blur();
  });
}

for (const boundary of ['POST_FAILED', 'GET_FAILED', 'TRIP_DONE', 'CANCELLED', 'PENDING'] as const) {
  test(`${boundary}에서는 물리 SUCCESS를 UI/음성의 확정 결과로 사용하지 않는다`, async () => {
    const screen = setup();
    if (boundary === 'POST_FAILED') screen.failPosts(3);
    else if (boundary === 'GET_FAILED') screen.failGet();
    else screen.statusResponse({ tripStatus: boundary === 'PENDING' ? 'NEAR_DESTINATION' : boundary, bellStatus: boundary === 'PENDING' ? 'PENDING' : 'SUCCESS' });
    screen.render('A', false); await flush(); screen.callbacks[0]!({ result: 'SUCCESS' }); await flush();
    assert.equal(screen.calls.states.includes('success'), false);
    assert.equal(screen.calls.states.includes('fail'), false);
    assert.equal(screen.speech.includes('하차벨이 정상적으로 작동했습니다.'), false);
    assert.equal(screen.notified.length, 0);
    screen.blur();
  });
}

test('최신 상태 GET 대기 중에는 물리 결과를 확정하지 않고 blur 뒤 응답도 무시한다', async () => {
  const screen = setup(); let resolve!: () => void;
  screen.deferGet(new Promise<void>(r => { resolve = r; }));
  screen.render('A', false); await flush(); screen.callbacks[0]!({ result: 'SUCCESS' }); await flush();
  assert.equal(screen.calls.states.at(-1), 'waiting'); screen.blur(); resolve(); await flush();
  assert.equal(screen.calls.states.includes('success'), false); assert.equal(screen.calls.dispatches, 0);
  assert.equal(screen.speech.includes('하차벨이 정상적으로 작동했습니다.'), false);
});

test('Realtime 연결 중에도 충돌 물리 결과 대신 서버 확정 결과로 UI와 세션을 갱신한다', async () => {
  const screen = setup(); screen.storedResult('SUCCESS'); screen.render(); await flush();
  screen.callbacks[0]!({ result: 'FAIL' }); await flush();
  assert.equal(screen.calls.states.at(-1), 'success');
  assert.equal((screen.notified[0] as { bellStatus: string }).bellStatus, 'SUCCESS');
  assert.equal(screen.speech.length, 0); screen.blur();
});
