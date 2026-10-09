import assert from 'node:assert/strict';
import test from 'node:test';
import { HaneumRealtimeSession } from '../apps/mobile/src/realtime/session.js';
import { initialState } from '../apps/mobile/src/state/trip-reducer.js';
import { createOneStopAlightGuide, ONE_STOP_GUIDE_MESSAGE } from '../apps/mobile/src/realtime/one-stop-alight-guide.js';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup() {
  let state:any={...initialState,tripId:'A'};
  const events:any[]=[];
  let disconnected=0;
  const session=new HaneumRealtimeSession({getAppState:()=>state,getCurrentLocation:()=>undefined,refreshCurrentLocation:async()=>{},dispatchAppAction(action){state={...state,lastInjectedStatus:(action as any).status};}},()=>disconnected++);
  const transport={send:(event:any)=>events.push(event),close:()=>events.push({type:'transport.closed'})};
  (session as any).transport=transport;
  return {session,events,disconnected:()=>disconnected,send:(event:any)=>session.handleServerEvent(event,transport)};
}

test('one-stop response requires matching metadata/id and actual output stop, not response.done',async()=>{
  const a=setup();let done=false;
  const promise=a.session.announceOneStopGuide('A','bell-A',1000).then(value=>{done=value;return value;});
  const create=a.events[0];assert.ok(create.response.instructions.includes(ONE_STOP_GUIDE_MESSAGE));
  await a.send({type:'response.created',response:{id:'guide',metadata:create.response.metadata}});
  await a.send({type:'output_audio_buffer.started',response_id:'guide'});
  await a.send({type:'response.done',response:{id:'guide',status:'completed'}});await flush();assert.equal(done,false);
  await a.send({type:'output_audio_buffer.stopped',response_id:'other'});await flush();assert.equal(done,false);
  await a.send({type:'output_audio_buffer.stopped',response_id:'guide'});assert.equal(await promise,true);
});

test('matching request shares one speech promise; terminal trip speech remains separate',async()=>{
  const a=setup();const first=a.session.announceOneStopGuide('A','bell-A',1000);
  assert.equal(a.session.announceOneStopGuide('A','bell-A'),first);assert.equal(a.events.length,1);
  a.session.cancelOneStopGuide('A','other');
  a.session.cancelOneStopGuide('A','bell-A');assert.equal(await first,false);
  const completion=a.session.announceTripCompletion('A',1000);
  a.session.cancelOneStopGuide('A','bell-A');a.session.cancelTripCompletion('A');assert.equal(await completion,false);
});

for(const event of [
  {type:'output_audio_buffer.cleared',response_id:'guide'},
  {type:'response.done',response:{id:'guide',status:'failed'}},
]) {
  test(`one-stop ${event.type} is failure, not normal playback`,async()=>{
    const a=setup();const promise=a.session.announceOneStopGuide('A','bell-A',1000);
    await a.send({type:'response.created',response:{id:'guide',metadata:a.events[0].response.metadata}});
    await a.send(event);assert.equal(await promise,false);
  });
}

test('missing start expires, closes output and ignores late response',async()=>{
  const a=setup();const promise=a.session.announceOneStopGuide('A','bell-A',5);const create=a.events[0];
  assert.equal(await promise,false);
  await a.send({type:'response.created',response:{id:'late',metadata:create.response.metadata}});
  assert.ok(a.events.some(event=>event.type==='transport.closed'));
  assert.equal(a.disconnected(),1);
});

test('transport close immediately releases speech and reports disconnect',async()=>{
  const a=setup();const promise=a.session.announceOneStopGuide('A','bell-A',1000);
  a.session.handleTransportClose();assert.equal(await promise,false);assert.equal(a.disconnected(),1);
  assert.equal(await a.session.announceOneStopGuide('A','bell-A'),false);
});

test('pending one-stop status is injected as fact without a second automatic audio response',()=>{
  const a=setup();a.session.notifyStatusChange({tripStatus:'NEAR_DESTINATION',boardingMethod:'USER_CONFIRMED',boardingConfirmedAt:'now',remainingStations:1,currentStation:null,bellStatus:'PENDING',guideMessage:'old'});
  assert.equal(a.events.filter(event=>event.type==='conversation.item.create').length,1);
  assert.equal(a.events.filter(event=>event.type==='response.create').length,0);
});

test('matching audio events without the requested metadata cannot complete the guide',async()=>{
  const a=setup();const promise=a.session.announceOneStopGuide('A','bell-A',5);
  await a.send({type:'response.created',response:{id:'other',metadata:{completionKey:'unrelated'}}});
  await a.send({type:'output_audio_buffer.started',response_id:'other'});
  await a.send({type:'response.done',response:{id:'other',status:'completed'}});
  await a.send({type:'output_audio_buffer.stopped',response_id:'other'});assert.equal(await promise,false);
});

test('response.create error fails promptly while unrelated errors do not complete playback',async()=>{
  const a=setup();let done=false;const promise=a.session.announceOneStopGuide('A','bell-A',1000).then(value=>{done=true;return value;});
  const key=a.events[0].event_id;
  await a.send({type:'error',error:{code:'invalid_request',event_id:'other'}});await flush();assert.equal(done,false);
  await a.send({type:'error',error:{code:'invalid_request',event_id:key}});assert.equal(await promise,false);
});

for(const failure of ['false','throw'] as const) {
  test(`Realtime ${failure} falls back to local onDone without treating generation as playback`,async()=>{
    let options:any;let calls=0;
    const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',isCurrent:()=>true,
      session:{announceOneStopGuide:async()=>{if(failure==='throw')throw Error('closed');return false;},cancelOneStopGuide(){}},
      speech:{speak(message,value){assert.equal(message,ONE_STOP_GUIDE_MESSAGE);calls++;options=value;},stop(){}}});
    const first=flow.start();assert.equal(flow.start(),first);let done=false;void first.then(()=>done=true);
    await flush();assert.equal(calls,1);assert.equal(done,false);options.onDone();assert.equal(await first,'played');options.onDone();
  });
}

for(const outcome of ['error','stopped','timeout','throw'] as const) {
  test(`local ${outcome} releases flow as unavailable`,async()=>{
    let options:any;let stopped=0;
    const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',isCurrent:()=>true,localTimeoutMs:5,
      speech:{speak(_message,value){options=value;if(outcome==='throw')throw Error('native');},stop(){stopped++;}}});
    const promise=flow.start();await flush();
    if(outcome==='error')options.onError();if(outcome==='stopped')options.onStopped();
    assert.equal(await promise,'unavailable');assert.equal(stopped,outcome==='stopped'?0:1);
  });
}

test('cancellation prevents old local callback and stops only the owned speech',async()=>{
  let options:any;let stopped=0;
  const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',isCurrent:()=>true,
    speech:{speak(_message,value){options=value;},stop(){stopped++;}}});
  const promise=flow.start();await flush();flow.cancel();options.onDone();assert.equal(await promise,'cancelled');assert.equal(stopped,1);
});

test('real session output beyond eight seconds never starts local fallback',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const a=setup();let local=0;let finished=0;
  const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',session:a.session,isCurrent:()=>true,
    speech:{speak(){local++;},stop(){}}});
  const promise=flow.start().then(value=>{finished++;return value;});
  t.mock.timers.tick(7000);await flush();
  await a.send({type:'response.created',response:{id:'guide',metadata:a.events[0].response.metadata}});
  await a.send({type:'output_audio_buffer.started',response_id:'guide'});
  await a.send({type:'response.done',response:{id:'guide',status:'completed'}});
  t.mock.timers.tick(9000);await flush();
  assert.equal(local,0);assert.equal(finished,0);
  assert.equal(a.events.some(e=>e.type==='response.cancel'),false);
  await a.send({type:'output_audio_buffer.stopped',response_id:'guide'});
  assert.equal(await promise,'played');assert.equal(finished,1);assert.equal(local,0);
});

test('normal local TTS beyond eight seconds waits for onDone',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});let options:any;let stops=0;let finished=0;
  const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',isCurrent:()=>true,
    speech:{speak(_message,value){options=value;},stop(){stops++;}}});
  const promise=flow.start().then(value=>{finished++;return value;});await flush();
  t.mock.timers.tick(9000);await flush();assert.equal(stops,0);assert.equal(finished,0);
  options.onDone();options.onError();options.onStopped();
  assert.equal(await promise,'played');assert.equal(finished,1);assert.equal(stops,0);
});

for(const order of ['done-first','stop-first'] as const) {
  test(`matching output completion supports ${order} and ignores other response.done`,async()=>{
    const a=setup();let finished=false;
    const promise=a.session.announceOneStopGuide('A','bell-A').then(value=>{finished=true;return value;});
    await a.send({type:'response.created',response:{id:'guide',metadata:a.events[0].response.metadata}});
    await a.send({type:'output_audio_buffer.started',response_id:'guide'});
    await a.send({type:'response.done',response:{id:'other',status:'completed'}});
    const done={type:'response.done',response:{id:'guide',status:'completed'}};
    const stopped={type:'output_audio_buffer.stopped',response_id:'guide'};
    await a.send(order==='done-first'?done:stopped);await flush();assert.equal(finished,false);
    await a.send(order==='done-first'?stopped:done);assert.equal(await promise,true);
  });
}

test('started output with missing completion closes before fallback at watchdog',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});const a=setup();let options:any;
  const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',session:a.session,isCurrent:()=>true,
    speech:{speak(_message,value){assert.ok(a.events.some(e=>e.type==='transport.closed'));options=value;},stop(){}}});
  const promise=flow.start();
  await a.send({type:'response.created',response:{id:'guide',metadata:a.events[0].response.metadata}});
  await a.send({type:'output_audio_buffer.started',response_id:'guide'});
  t.mock.timers.tick(60000);await flush();assert.ok(options);
  options.onDone();assert.equal(await promise,'played');
});

test('disconnect closes output before local speech; late events settle navigation once',async()=>{
  const a=setup();let options:any;let navigations=0;
  const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',session:a.session,isCurrent:()=>true,
    speech:{speak(_message,value){assert.ok(a.events.some(e=>e.type==='transport.closed'));options=value;},stop(){}}});
  const promise=flow.start().then(value=>{navigations++;return value;});
  await a.send({type:'response.created',response:{id:'guide',metadata:a.events[0].response.metadata}});
  await a.send({type:'output_audio_buffer.started',response_id:'guide'});
  a.session.handleTransportClose();await flush();assert.equal(navigations,0);
  await a.send({type:'response.done',response:{id:'guide',status:'completed'}});
  await a.send({type:'output_audio_buffer.stopped',response_id:'guide'});
  options.onDone();options.onDone();options.onError();
  assert.equal(await promise,'played');assert.equal(navigations,1);
});

test('native stop delay blocks completion and replacement speech',async()=>{
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  let options:any;let speaks=0;let finished=false;
  const speech={speak(_message:string,value:any){speaks++;options=value;},stop:()=>pending};
  const first=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',isCurrent:()=>true,speech});
  const result=first.start().then(value=>{finished=true;return value;});await flush();
  options.onError();options.onDone();await flush();assert.equal(finished,false);
  const second=createOneStopAlightGuide({tripId:'B',bellRequestId:'bell-B',isCurrent:()=>true,speech});
  const next=second.start();await flush();assert.equal(speaks,1);
  release();assert.equal(await result,'unavailable');await flush();assert.equal(speaks,2);
  options.onDone();assert.equal(await next,'played');
});

for(const failure of ['reject','hang','throw'] as const) {
  test(`native stop ${failure} is bounded and suppresses following speech`,async(t)=>{
    t.mock.timers.enable({apis:['setTimeout']});let options:any;let speaks=0;let stops=0;
    const speech={speak(_message:string,value:any){speaks++;options=value;},stop(){stops++;
      if(failure==='throw')throw Error('stop');
      return failure==='reject'?Promise.reject(Error('stop')):new Promise<void>(()=>{});
    }};
    const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',isCurrent:()=>true,speech});
    const promise=flow.start();await flush();options.onError();await flush();
    t.mock.timers.tick(1500);await flush();t.mock.timers.tick(1500);await flush();
    assert.equal(await promise,'unavailable');assert.equal(flow.canSpeak(),false);assert.equal(stops,failure==='hang'?1:2);
    const next=createOneStopAlightGuide({tripId:'B',bellRequestId:'bell-B',isCurrent:()=>true,speech});
    assert.equal(await next.start(),'unavailable');assert.equal(next.canSpeak(),false);assert.equal(speaks,1);
  });
}

test('failed Realtime native cleanup suppresses local fallback',async()=>{
  const a=setup();(a.session as any).transport.close=()=>{throw Error('native close');};let speaks=0;
  const speech={speak(){speaks++;},stop(){}};
  const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',session:a.session,isCurrent:()=>true,
    speech});const promise=flow.start();
  a.session.handleTransportClose();assert.equal(await promise,'unavailable');
  assert.equal(flow.canSpeak(),false);assert.equal(speaks,0);
  const next=createOneStopAlightGuide({tripId:'B',bellRequestId:'bell-B',session:a.session,isCurrent:()=>true,speech});
  assert.equal(await next.start(),'unavailable');assert.equal(speaks,0);
});

test('local missing callback watchdog waits for successful native stop before releasing',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});let stops=0;let finished=false;let release!:()=>void;
  const cleanup=new Promise<void>(resolve=>{release=resolve;});
  const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',isCurrent:()=>true,
    speech:{speak(){},stop(){stops++;return cleanup;}}});
  const result=flow.start().then(value=>{finished=true;return value;});await flush();
  t.mock.timers.tick(59999);await flush();assert.equal(stops,0);
  t.mock.timers.tick(1);await flush();assert.equal(stops,1);assert.equal(finished,false);
  release();assert.equal(await result,'unavailable');assert.equal(flow.canSpeak(),true);
});

test('failed native stop retries once and permits speech only after successful cleanup',async()=>{
  let options:any;let stops=0;
  const flow=createOneStopAlightGuide({tripId:'A',bellRequestId:'bell-A',isCurrent:()=>true,
    speech:{speak(_message,value){options=value;},stop(){if(++stops===1)throw Error('transient');}}});
  const result=flow.start();await flush();options.onError();
  assert.equal(await result,'unavailable');assert.equal(stops,2);assert.equal(flow.canSpeak(),true);
});
