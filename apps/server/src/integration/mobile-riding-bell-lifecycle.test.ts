import * as tracking from '../../../mobile/src/realtime/trip-tracking.js';
import * as automaticBoarding from '../../../mobile/src/realtime/automatic-boarding.js';
import * as completionSpeech from '../../../mobile/src/realtime/completion-speech.js';
import * as caneRelease from '../../../mobile/src/ble/cane-release-controller.js';
import { tripReducer } from '../../../mobile/src/state/trip-reducer.js';
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
    exports, console, AbortController,
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

function setup(options: { gps?: boolean; auto?: boolean; offlineCompletion?: boolean } = {}) {
  const providerHooks = hooks();
  const screenHooks = hooks();
  let state: any = { tripId: 'A', tripStatus: 'ON_BUS', boardingConfirmedAt: 'now', bellConnected: null,
    targetBeaconId: 'BUS_A', beaconPreparationCompleted: true, beaconScanActive: false };
  if(options.auto) state={...state,tripStatus:'WAITING_BUS',boardingConfirmedAt:null,caneReady:true,beaconScanActive:true};
  let locationCallback:any, caneCallback:any, resolveCompletion:()=>void=()=>{}, speechOptions:any;
  let nextStatus:any={tripId:'A',tripStatus:'NEAR_DESTINATION',boardingConfirmedAt:'now',bellStatus:'PENDING',shouldTriggerBell:true,remainingStations:1,bellRequestId:'bell-A',command:'STOP_REQUEST'};
  let confirmation:any=null;
  let clock=Date.now();
  let delivered = true;
  let realtime: any;
  const calls = { events: [] as any[], speech: [] as string[], releases: [] as string[], connects: 0, actions: [] as any[], patches: [] as any[], gpsRemoved: 0, autoRemoved: 0, autoRequests: [] as any[], completions: 0, navigations: [] as any[] };
  const shared = {
    'expo-speech': { speak: (message: string, options:any) => {calls.speech.push(message);speechOptions=options;if(message!==tracking.TRIP_COMPLETION_MESSAGE)options?.onDone?.();}, stop() {} },
    'expo-location': {
      Accuracy:{High:1},requestForegroundPermissionsAsync: () => options.gps ? Promise.resolve({status:'granted'}) : new Promise(() => {}),
      watchPositionAsync: async (_options:any,callback:any) => {locationCallback=callback;return {remove(){calls.gpsRemoved++;}};},
    },
    '../state/TripContext': { useTrip: () => ({ state, dispatch: (action: any) => {calls.actions.push(action);state=tripReducer(state,action);} }) },
    '../api/client': { ApiError: class extends Error {}, apiClient: {trips:{
      updateStatus: async (_id:string,body:any)=>{calls.patches.push(body);return nextStatus;},
      confirmBoarding: async (_id:string,body:any)=>{calls.autoRequests.push(body);return confirmation ?? {success:true,tripId:'A',tripStatus:'ON_BUS',boardingMethod:'AUTO_DETECTED',boardingConfirmedAt:'now'};},
    }} },
    '../ble/bleManager': {
      subscribeCaneState: (callback:any)=>{caneCallback=callback;return()=>{calls.autoRemoved++;};},
      connectBell: async () => { calls.connects++; return null; },
      disconnectBellsForTrip: async (tripId: string) => { calls.releases.push(tripId); },
    },
  };
  const Provider = load('../../../mobile/src/realtime/RealtimeProvider.tsx', {
    ...shared, react: providerHooks.React,
    './session': { HaneumRealtimeSession: class {
      notifyStatusChange() {}
      cancelTripCompletion() {}
      announceTripCompletion() {calls.completions++;return options.offlineCompletion ? Promise.resolve(false) : new Promise<boolean>(resolve=>{resolveCompletion=()=>resolve(true);});}
      notifyAssistDeviceStatusChange(event: any) { calls.events.push(event); return delivered; } } },
    './context': { createRealtimeGuideContext: () => ({}) },
    './connect-best-effort': {},
    './location-refresh': { createLocationRefreshCoordinator: () => async () => {} },
    './assist-device-preparation': { createAssistDevicePreparation: () => ({ prepare() {}, release() {} }) },
    './assist-device-status': assistStatus,
    './trip-tracking': tracking,
    './status-snapshot': statusSnapshot,
    './automatic-boarding': {createAutomaticBoarding:(deps:any)=>automaticBoarding.createAutomaticBoarding({...deps,now:()=>clock})},
    './completion-speech': completionSpeech,
    '../ble/cane-release-controller': caneRelease,
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
    '../realtime/trip-tracking': tracking,
    '../ble/beacon-scan-gate': { canStartBeaconScan: () => false },
    '../ble/beacon-scan-controller': {},
    '../ble/bell-connect-controller': bellController,
  }).default;
  return {
    calls,
    setStatus: (value:any)=>{nextStatus=value;},
    sampleLocation:()=>locationCallback({timestamp:Date.now(),coords:{latitude:37,longitude:127}}),
    sampleCane:()=>{clock+=1000;caneCallback({rssi:-50,beaconId:state.targetBeaconId,timestamp:clock});},
    deferConfirmation:(promise:Promise<any>)=>{confirmation=promise;},
    complete:()=>resolveCompletion(), localSpeechDone:()=>speechOptions.onDone(),
    provider(next = state) {
      state = next;
      realtime = providerHooks.render(() => Provider({ children: null })).props.value;
    },
    screen(tripId = state.tripId) {
      if(options.gps && !options.offlineCompletion) realtime.isConnected=true;
      screenHooks.render(() => Screen({ route: { params: { tripId } }, navigation: {navigate:(...args:any[])=>calls.navigations.push(args)} }));
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


test('실제 Provider GPS는 Riding blur 후에도 Alight 구간을 추적하고 완료 음성 후 reset한다', async()=>{
  const app=setup({gps:true});app.provider();app.screen();await flush();
  await app.sampleLocation();app.provider();app.screen();await flush();
  assert.equal(app.calls.navigations[0]?.[0],'Alight');
  app.leaveRiding();assert.equal(app.calls.gpsRemoved,0);
  app.setStatus({tripId:'A',tripStatus:'TRIP_DONE',boardingConfirmedAt:'now',remainingStations:0,bellStatus:'SUCCESS'});
  await app.sampleLocation();app.provider();await flush();
  assert.equal(app.calls.gpsRemoved,1);assert.equal(app.calls.completions,1);assert.equal(app.state.tripId,'A');
  app.complete();await flush();app.provider();assert.equal(app.state.tripId,null);assert.deepEqual(app.calls.releases,['A']);app.dispose();
});

test('Realtime 연결이 없는 Provider도 로컬 완료음성이 실제 끝난 다음 reset한다',async()=>{
  const app=setup({gps:true,offlineCompletion:true});app.provider();await flush();
  app.setStatus({tripId:'A',tripStatus:'TRIP_DONE'});await app.sampleLocation();app.provider();await flush();
  assert.equal(app.calls.speech.at(-1),tracking.TRIP_COMPLETION_MESSAGE);assert.equal(app.state.tripId,'A');
  app.localSpeechDone();await flush();assert.equal(app.state.tripId,null);app.dispose();
});

test('실제 Provider caneNotify→detector→AUTO_DETECTED API는 성공 전 상태를 바꾸지 않는다',async()=>{
  const app=setup({auto:true});let resolve!:(value:any)=>void;
  app.deferConfirmation(new Promise(r=>resolve=r));app.provider();for(let i=0;i<8;i++)app.sampleCane();await flush();
  assert.equal(app.calls.autoRequests.length,1);assert.equal(app.state.tripStatus,'WAITING_BUS');
  resolve({success:true,tripId:'A',tripStatus:'ON_BUS',boardingMethod:'AUTO_DETECTED',boardingConfirmedAt:'now'});await flush();app.provider();
  assert.equal(app.state.tripStatus,'ON_BUS');assert.equal(app.calls.autoRemoved,1);app.dispose();
});

test('자동 API 진행 중 수동 탑승/취소/다음운행의 상태를 늦은 응답이 덮지 않는다',async()=>{
 for(const next of [{tripId:'A',tripStatus:'ON_BUS',boardingMethod:'USER_CONFIRMED',boardingConfirmedAt:'manual'},{tripId:null,tripStatus:null},{tripId:'B',tripStatus:'WAITING_BUS'}]) {
  const app=setup({auto:true});let resolve!:(v:any)=>void;app.deferConfirmation(new Promise(r=>resolve=r));app.provider();for(let i=0;i<8;i++)app.sampleCane();await flush();
  app.provider({...app.state,...next});resolve({success:true,tripId:'A',tripStatus:'ON_BUS',boardingMethod:'AUTO_DETECTED',boardingConfirmedAt:'auto'});await flush();
  assert.equal(app.state.tripId,next.tripId);assert.equal(app.state.tripStatus,next.tripStatus);assert.equal(app.calls.actions.filter(a=>a.type==='CONFIRM_BOARDING').length,0);app.dispose();
 }
});

test('같은 Riding 인스턴스의 다음 운행도 하차벨 화면으로 이동한다',async()=>{
 const app=setup({gps:true});app.provider();app.screen();await flush();await app.sampleLocation();app.provider();app.screen();await flush();
 app.provider({...app.state,tripId:'B',bellRequestId:'bell-B'});app.screen('B');await flush();
 assert.equal(app.calls.navigations.filter(item=>item[0]==='Alight').length,2);app.dispose();
});
