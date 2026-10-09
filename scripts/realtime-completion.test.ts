import assert from 'node:assert/strict';
import test from 'node:test';
import { HaneumRealtimeSession } from '../apps/mobile/src/realtime/session.js';
import { initialState } from '../apps/mobile/src/state/trip-reducer.js';
import { speakCompletionFallback } from '../apps/mobile/src/realtime/completion-speech.js';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function setup(){
 const events:any[]=[]; const session=new HaneumRealtimeSession({getAppState:()=>({...initialState,tripId:'A'}) as any,getCurrentLocation:()=>undefined,refreshCurrentLocation:async()=>{},dispatchAppAction(){}});
 const transport={send:(e:any)=>events.push(e)};(session as any).transport=transport;
 return {session,events,send:(e:any)=>session.handleServerEvent(e,transport)};
}
test('완료 응답의 생성 종료만으로 끝내지 않고 같은 response의 실제 출력 종료를 기다린다',async()=>{
 const a=setup();let done=false;const p=a.session.announceTripCompletion('A',1000).then(v=>{done=v;});
 const create=a.events.find(e=>e.type==='response.create');
 await a.send({type:'response.created',response:{id:'new',metadata:create.response.metadata}});
 await a.send({type:'output_audio_buffer.started',response_id:'new'});
 await a.send({type:'response.done',response:{id:'new',status:'completed'}});await flush();assert.equal(done,false);
 await a.send({type:'output_audio_buffer.stopped',response_id:'old'});await flush();assert.equal(done,false);
 await a.send({type:'output_audio_buffer.stopped',response_id:'new'});await p;assert.equal(done,true);
});
test('출력 없음은 유한 deadline 후 false이며 대기 완료 응답을 폐기한다',async()=>{
 const a=setup();(a.session as any).isResponseActive=true;
 assert.equal(await a.session.announceTripCompletion('A',5),false);
 await a.send({type:'response.done',response:{id:'old',status:'completed'}});
 assert.equal(a.events.filter(e=>e.type==='response.create').length,0);
});
test('연결 없음/local TTS 무응답도 유한 시간 후 종료한다',async()=>{
 let stopped=0;await speakCompletionFallback({speak(){},stop(){stopped++;}},5);assert.equal(stopped,1);
});

test('completion 전송 예외도 false로 종료해 호출부 로컬TTS fallback을 허용한다',async()=>{
 const a=setup();(a.session as any).transport={send(){throw Error('closed');}};
 assert.equal(await a.session.announceTripCompletion('A',1000),false);
});

test('운행 변경은 완료 대기 응답과 로컬TTS를 취소한다',async()=>{
 const a=setup();(a.session as any).isResponseActive=true;const p=a.session.announceTripCompletion('A',1000);a.session.cancelTripCompletion('A');assert.equal(await p,false);
 const abort=new AbortController();let stopped=0;const local=speakCompletionFallback({speak(){},stop(){stopped++;}},1000,abort.signal);abort.abort();await local;assert.equal(stopped,1);
});

test('timeout 뒤 늦게 생성된 완료 응답은 해당 response만 취소하며 다시 재생하지 않는다',async()=>{
 const a=setup();const p=a.session.announceTripCompletion('A',5);const create=a.events.find(e=>e.type==='response.create');assert.equal(await p,false);
 await a.send({type:'response.created',response:{id:'late',metadata:create.response.metadata}});
 assert.ok(a.events.some(e=>e.type==='response.cancel' && e.response_id==='late'));
 await a.send({type:'output_audio_buffer.started',response_id:'late'});
 assert.ok(a.events.some(e=>e.type==='output_audio_buffer.clear'));
});

test('출력 취소의 cleared 이벤트 뒤 다음 운행 음성 큐가 막히지 않는다',async()=>{
 const a=setup();const first=a.session.announceTripCompletion('A',1000);const create=a.events.find(e=>e.type==='response.create');
 await a.send({type:'response.created',response:{id:'cancelled',metadata:create.response.metadata}});await a.send({type:'output_audio_buffer.started',response_id:'cancelled'});
 a.session.cancelTripCompletion('A');await first;const second=a.session.announceTripCompletion('B',1000);
 await a.send({type:'output_audio_buffer.cleared',response_id:'cancelled'});
 assert.equal(a.events.filter(e=>e.type==='response.create').length,2);a.session.cancelTripCompletion('B');await second;
});
