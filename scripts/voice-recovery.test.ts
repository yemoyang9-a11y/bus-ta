import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafeSpeech, getSafeSpeech } from '../apps/mobile/src/realtime/safe-speech.js';
import { createVoiceRecovery } from '../apps/mobile/src/realtime/voice-recovery.js';
import { runWithRealtimeConnectionTimeout } from '../apps/mobile/src/realtime/connection-timeout.js';
import { HaneumRealtimeSession } from '../apps/mobile/src/realtime/session.js';
import { initialState } from '../apps/mobile/src/state/trip-reducer.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};
}
function setup(connect?:()=>Promise<{close:()=>void}>) {
  let context='A:0';let publishes=0;let discards=0;let attempts=0;let stops=0;
  const states:string[]=[];const speech=createSafeSpeech({speak(){},stop(){stops++;}});
  const recovery=createVoiceRecovery({speech,getContext:()=>context,repairOutput:()=>true,
    connect:async()=>{attempts++;return connect?connect():{close(){}};},
    publish:()=>{publishes++;},discard:transport=>{discards++;transport.close();},
    onStatus:state=>states.push(state)});
  return {speech,recovery,states,replace:()=>{context='B:1';},counts:()=>({publishes,discards,attempts,stops})};
}

test('explicit reconnect repairs audio first and publishes one connection',async()=>{
  const a=setup();assert.equal(await a.recovery.run(),true);
  assert.deepEqual(a.counts(),{publishes:1,discards:0,attempts:1,stops:1});
  assert.equal(a.speech.canSpeak(),true);assert.deepEqual(a.states,['connecting','connected']);
});
test('failed reconnect leaves local speech available and has no retry loop',async()=>{
  const a=setup(async()=>{throw Error('network');});assert.equal(await a.recovery.run(),false);await flush();
  assert.equal(a.counts().attempts,1);assert.equal(a.speech.canSpeak(),true);
  assert.deepEqual(a.states,['connecting','error']);
});
test('concurrent recovery requests share one pending connection',async()=>{
  const pending=deferred<{close:()=>void}>();const a=setup(()=>pending.promise);
  const first=a.recovery.run();assert.equal(a.recovery.run(),first);await flush();
  assert.equal(a.counts().attempts,1);assert.equal(a.speech.canSpeak(),false);
  pending.resolve({close(){}});assert.equal(await first,true);assert.equal(a.counts().publishes,1);
});
for(const boundary of ['replace','blur','cancel'] as const) {
  test(`late reconnect is discarded after ${boundary}`,async()=>{
    const pending=deferred<{close:()=>void}>();const a=setup(()=>pending.promise);let closed=0;
    const signal=new AbortController();const result=a.recovery.run(signal.signal);await flush();
    if(boundary==='replace')a.replace();else if(boundary==='blur')signal.abort();else a.recovery.cancel();
    pending.resolve({close(){closed++;}});assert.equal(await result,false);
    assert.equal(closed,1);assert.equal(a.counts().publishes,0);assert.equal(a.states.at(-1),'idle');
  });
}
test('connection cancellation aborts native handshake and rejects without waiting for deadline',async()=>{
  const controller=new AbortController();let nativeSignal:AbortSignal|undefined;
  const result=runWithRealtimeConnectionTimeout(signal=>{nativeSignal=signal;return new Promise<void>(()=>{});},20000,controller.signal);
  await flush();controller.abort();await assert.rejects(result,/VOICE_RECOVERY_CANCELLED/);
  assert.equal(nativeSignal?.aborted,true);
});
test('failed stops suppress every namespace of the same speech device; explicit recovery resumes',async()=>{
  let fail=true;let spoken=0;
  const native={speak(){spoken++;},stop(){if(fail)throw Error('native');}};
  const first=getSafeSpeech(native);const transfer=getSafeSpeech({...native});
  assert.equal(first,transfer);assert.equal(await first.stop(),false);
  assert.equal(transfer.speak('transfer'),false);assert.equal(spoken,0);
  fail=false;assert.equal(await transfer.recover(),true);assert.equal(transfer.speak('transfer'),true);assert.equal(spoken,1);
});
test('timed-out old stop cannot be bypassed by trip replacement or a recovery retry',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});let stops=0;let spoken=0;
  const old=deferred<void>();const speech=createSafeSpeech({speak(){spoken++;},stop(){return ++stops===1?old.promise:Promise.resolve();}});
  const stopping=speech.stop();await flush();t.mock.timers.tick(1500);await flush();assert.equal(await stopping,false);
  const retry=speech.recover();await flush();t.mock.timers.tick(1500);await flush();assert.equal(await retry,false);
  assert.equal(stops,1);assert.equal(speech.speak('next trip'),false);
  old.resolve();await flush();assert.equal(speech.canSpeak(),false);
  assert.equal(await speech.recover(),true);assert.equal(stops,2);
  assert.equal(speech.speak('new guide'),true);await flush();assert.equal(spoken,1);
});
test('cancelled audio recovery never connects or announces for replacement trip',async()=>{
  const old=deferred<void>();let connects=0;let context='A';
  const speech=createSafeSpeech({speak(){assert.fail('unexpected speech');},stop:()=>old.promise});
  const recovery=createVoiceRecovery({speech,getContext:()=>context,repairOutput:()=>true,
    connect:async()=>{connects++;return {};},publish(){assert.fail('stale connection');},discard(){},onStatus(){}});
  const result=recovery.run();await flush();context='B';recovery.cancel();old.resolve();
  assert.equal(await result,false);assert.equal(connects,0);
});
test('failed remote output is retained and repaired before fresh local speech',async()=>{
  let fail=true;let closed=0;
  const session=new HaneumRealtimeSession({getAppState:()=>initialState as any,getCurrentLocation:()=>undefined,refreshCurrentLocation:async()=>{},dispatchAppAction(){}});
  (session as any).transport={send(){},close(){closed++;if(fail)throw Error('native peer');}};
  const guide=session.announceOneStopGuide('A','bell-A');session.handleTransportClose();
  await assert.rejects(guide,/GUIDE_AUDIO_CLEANUP_FAILED/);assert.equal(session.recoverOutput(),false);
  const speech=createSafeSpeech({speak(){},stop(){}});speech.blockExternal();assert.equal(await speech.recover(),false);
  fail=false;assert.equal(session.recoverOutput(),true);speech.clearExternalBlock();
  assert.equal(await speech.recover(),true);assert.equal(speech.canSpeak(),true);assert.equal(closed,3);
});

test('initial normal connection skips native stop and preserves normal startup flag',async()=>{
  let stop=0;let recoveryFlag:boolean|undefined;
  const speech=createSafeSpeech({speak(){},stop(){stop++;}});
  const recovery=createVoiceRecovery({speech,getContext:()=>'',repairOutput:()=>true,
    connect:async(_signal,recovery)=>{recoveryFlag=recovery;return {};},publish(){},discard(){},onStatus(){}});
  assert.equal(await recovery.run(undefined,false),true);assert.equal(stop,0);assert.equal(recoveryFlag,false);
});
test('recovered session restores trip and transfer facts without speaking or sending BLE',()=>{
  const events:any[]=[];const state={...initialState,tripId:'A',tripStatus:'NEAR_DESTINATION',remainingStations:1,bellStatus:'PENDING',
    journeySegmentIndex:0,journeyPhase:'GUIDING',journeyRoute:{segments:[{mode:'BUS',startName:'start',endName:'end',lineNames:[],routeNumbers:['20']}]}};
  const session=new HaneumRealtimeSession({getAppState:()=>state as any,getCurrentLocation:()=>undefined,refreshCurrentLocation:async()=>{},dispatchAppAction(){}});
  (session as any).transport={send:(event:any)=>events.push(event)};session.restoreActiveContext();
  assert.equal(events.length,1);assert.equal(events[0].type,'conversation.item.create');
  const restored=JSON.parse(events[0].item.content[0].text);
  assert.equal(restored.tripId,'A');assert.equal(restored.journeySegmentIndex,0);assert.equal(restored.segment.mode,'BUS');
});

for(const phase of ['GUIDING','BUS_ALIGHT_CONFIRM'] as const) {
test(`actual TransferScreen suppresses unsafe speech and replays ${phase} after recovery`,async()=>{
  let fail=true;const spoken:string[]=[];
  const native={speak:(message:string)=>spoken.push(message),stop(){if(fail)throw Error('stop');}};
  const speech=getSafeSpeech(native);assert.equal(await speech.stop(),false);
  let voiceRecoveryVersion=0;
  const state={journeyRoute:{segments:[{mode:phase==='GUIDING'?'WALK':'BUS',startName:'start',endName:'next stop'}]},
    journeyGeneration:1,journeySegmentIndex:0,journeyPhase:phase,tripId:phase==='GUIDING'?null:'A'};
  const slots:any[]=[];let cursor=0;let effects:(()=>void)[]=[];
  const React={createElement(){return null;},useRef:(value:any)=>slots[cursor++]??={current:value},
    useState:(value:any)=>[value,()=>{}],useEffect:(callback:()=>void,deps:any[])=>{
      const index=cursor++;const old=slots[index];
      if(!old||deps.some((value,i)=>value!==old[i])){slots[index]=deps;effects.push(callback);}
    }};
  const modules:Record<string,any>={react:React,'expo-speech':native,
    'react-native':{StyleSheet:{create:(value:any)=>value}},'@react-navigation/native':{useIsFocused:()=>true},
    '../state/TripContext':{useTrip:()=>({state,dispatch(){}})},
    '../realtime/RealtimeProvider':{useRealtime:()=>({speechBlocked:!speech.canSpeak(),voiceRecoveryVersion})},
    '../realtime/safe-speech':{getSafeSpeech},'../realtime/VoiceRecoveryControl':{default:()=>null},
    '../api/client':{},'../state/transfer-journey':{}};
  const exports:any={};runInNewContext(ts.transpileModule(readFileSync(new URL('../apps/mobile/src/screens/TransferScreen.js',import.meta.url),'utf8'),{
    fileName:'TransferScreen.jsx',compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true},
  }).outputText,{exports,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
  const render=()=>{cursor=0;effects=[];exports.default({navigation:{navigate(){}}});effects.forEach(effect=>effect());};
  render();assert.equal(spoken.length,0);
  fail=false;const recovery=createVoiceRecovery({speech,getContext:()=> 'transfer:1',repairOutput:()=>true,
    connect:async()=>({}),publish(){},discard(){},onStatus(){},onAudioRecovered(){voiceRecoveryVersion++;}});
  assert.equal(await recovery.run(),true);render();assert.deepEqual(spoken,[phase==='GUIDING'
    ?'next stop까지 도보로 이동한 뒤 도착을 확인해 주세요.':'next stop에서 실제로 내린 뒤 하차를 확인해 주세요.']);
  render();assert.equal(spoken.length,1);
});
}

test('a replacement session must repair retained old output before clearing the shared block',async()=>{
  let stopped=false;const speech=createSafeSpeech({speak(){},stop(){}});
  speech.blockExternal(()=>stopped);assert.equal(speech.repairExternalOutput(),false);
  assert.equal(speech.speak('new session'),false);
  stopped=true;assert.equal(speech.repairExternalOutput(),true);speech.clearExternalBlock();
  assert.equal(await speech.recover(),true);assert.equal(speech.speak('new session'),true);
});

test('late release by an old Provider cannot unblock a replacement recovery',async()=>{
  const speech=createSafeSpeech({speak(){},stop(){}});
  const first=deferred<{}>();const second=deferred<{}>();
  const make=(pending:Promise<{}>)=>createVoiceRecovery({speech,getContext:()=>'',repairOutput:()=>true,
    connect:()=>pending,publish(){},discard(){},onStatus(){}});
  const old=make(first.promise);const fresh=make(second.promise);
  const a=old.run();await flush();const b=fresh.run();await flush();
  old.cancel();first.resolve({});assert.equal(await a,false);assert.equal(speech.canSpeak(),false);
  second.resolve({});assert.equal(await b,true);assert.equal(speech.canSpeak(),true);
});

test('actual recovery control coalesces presses and aborts on screen cleanup',async()=>{
  const done=deferred<boolean>();let calls=0;let signal:AbortSignal|undefined;let cleanup=()=>{};let press=()=>{};
  const modules:Record<string,any>={
    react:{useRef:()=>({current:null}),useEffect:(effect:()=>()=>void)=>{cleanup=effect();},
      createElement:(_component:any,props:any)=>{if(props?.onPress)press=props.onPress;return null;}},
    'react-native':{StyleSheet:{create:(value:any)=>value}},'@react-navigation/native':{useIsFocused:()=>true},
    './RealtimeProvider':{useRealtime:()=>({connectionStatus:'error',speechBlocked:true,
      recoverVoice:(value:AbortSignal)=>{calls++;signal=value;return done.promise;}})},
  };
  const exports:any={};runInNewContext(ts.transpileModule(readFileSync(new URL('../apps/mobile/src/realtime/VoiceRecoveryControl.js',import.meta.url),'utf8'),{
    fileName:'VoiceRecoveryControl.jsx',compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true},
  }).outputText,{exports,AbortController,require:(name:string)=>modules[name]});
  exports.default();press();press();assert.equal(calls,1);cleanup();assert.equal(signal?.aborted,true);
  done.resolve(false);await flush();
});
