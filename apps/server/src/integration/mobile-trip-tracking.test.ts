import assert from 'node:assert/strict';
import test from 'node:test';
import { createTripTracking, arrivalRefreshDelay } from '../../../mobile/src/realtime/trip-tracking.js';
const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
function setup() {
  let state: any = { tripId: 'A', tripStatus: 'WAITING_BUS', nextArrivalRefreshInMs: 60000 };
  let sample: any;
  let nextStatus: any = { tripId: 'A', tripStatus: 'ON_BUS' };
  let finishSpeech!: () => void;
  let pendingPatch: Promise<any> | null = null;
  let pollError=false;
  let pendingPoll:Promise<any>|null=null;
  const calls = { removed: 0, patches: [] as any[], statuses: [] as any[], finished: 0, spoken: 0, polls: 0 };
  const timers = new Map<number, { callback: () => void; ms: number }>(); let seq=0;
  const controller = createTripTracking({
    tripId:'A', getState: () => state,
    requestPermission: async () => 'granted',
    watchPosition: async (callback: any) => { sample=callback; return { remove() { calls.removed++; } }; },
    updateStatus: async (_id: string, body: any) => { calls.patches.push(body); return pendingPatch ?? nextStatus; },
    getStatus: async ():Promise<any> => { calls.polls++; if(pollError)throw Error('network');if(pendingPoll)return pendingPoll; return { tripId:'A', tripStatus:'WAITING_BUS', nextArrivalRefreshInMs:60000 }; },
    applyStatus: (status: any) => { calls.statuses.push(status); state={...state,...status}; },
    announceCompletion: () => { calls.spoken++; return new Promise<void>((resolve)=>{ finishSpeech=resolve; }); },
    finish: () => { calls.finished++; }, onError: () => {},
    schedule: (callback: () => void, ms: number) => { const id=++seq;timers.set(id,{callback,ms});return id; },
    cancelTimer: (id: number) => { timers.delete(id); },
  });
  controller.start();
  return { controller, calls, timers, setState: (value:any)=>{state={...state,...value};controller.sync();},
    setNext: (value:any)=>{nextStatus=value;},
    failPoll:()=>{pollError=true;},deferPoll:(p:Promise<any>)=>{pendingPoll=p;}, deferPatch: (p:Promise<any>)=>{pendingPatch=p;},
    sample: ()=>sample({ timestamp: Date.now(), coords: { latitude:37,longitude:127 } }),
    finishSpeech:()=>finishSpeech(), tick:()=>{ const [id,t]=[...timers][0]!;timers.delete(id);t.callback(); },
  };
}
test('운행 단위 GPS는 하차 단계에서도 계속 보내고 완료 음성 후에만 정리한다',async()=>{
  const a=setup();await flush();a.setState({tripStatus:'NEAR_DESTINATION'});
  a.setNext({tripId:'A',tripStatus:'NEAR_DESTINATION'});await a.sample();
  a.setNext({tripId:'A',tripStatus:'TRIP_DONE'});await a.sample();await flush();
  assert.equal(a.calls.patches.length,2);assert.equal(a.calls.removed,1);
  assert.equal(a.calls.spoken,1);assert.equal(a.calls.finished,0);
  a.finishSpeech();await flush();assert.equal(a.calls.finished,1);a.controller.stop();
});
test('이전 GPS 응답은 새 운행 상태를 복원하지 않는다',async()=>{
  const a=setup();await flush();let resolve!: (v:any)=>void;
  a.deferPatch(new Promise(r=>resolve=r));void a.sample();a.setState({tripId:'B'});
  resolve({tripId:'A',tripStatus:'ON_BUS'});await flush();assert.equal(a.calls.statuses.length,0);a.controller.stop();
});
test('서버 60000ms 후 한 번 조회하고 응답마다 재예약하며 탑승하면 예약을 지운다',async()=>{
  const a=setup();await flush();assert.deepEqual([...a.timers.values()].map(t=>t.ms),[60000]);
  a.tick();await flush();assert.equal(a.calls.polls,1);assert.deepEqual([...a.timers.values()].map(t=>t.ms),[60000]);
  a.setState({tripStatus:'ON_BUS'});assert.equal(a.timers.size,0);a.controller.stop();
});
test('도착 갱신 지연은 0에 최소1초, 잘못된 값에만15초를 쓴다',()=>{
  assert.deepEqual([0,60000,undefined,-1,NaN,Infinity].map(arrivalRefreshDelay),[1000,60000,15000,15000,15000,15000]);
});


test('도착 조회 오류는15초 재예약하며 GPS를 중지하지 않는다',async()=>{
 const a=setup();await flush();a.failPoll();a.tick();await flush();assert.deepEqual([...a.timers.values()].map(t=>t.ms),[15000]);assert.equal(a.calls.removed,0);a.controller.stop();assert.equal(a.timers.size,0);
});

test('탑승/교체 뒤 늦은 도착 응답은 적용하거나 다시 예약하지 않는다',async()=>{
 for(const state of [{tripId:'B'},{tripStatus:'ON_BUS',boardingConfirmedAt:'now'}]) {
  const a=setup();await flush();let resolve!:(v:any)=>void;a.deferPoll(new Promise(r=>resolve=r));a.tick();await flush();a.setState(state);
  resolve({tripId:'A',tripStatus:'WAITING_BUS',nextArrivalRefreshInMs:60000});await flush();assert.equal(a.calls.statuses.length,0);assert.equal(a.timers.size,0);a.controller.stop();
 }
});

test('화면을 넘어 새 controller의 위치 requestId도 이전 요청과 충돌하지 않는다',async()=>{
 const a=setup();await flush();await a.sample();a.controller.stop();const b=setup();await flush();await b.sample();assert.notEqual(a.calls.patches[0].requestId,b.calls.patches[0].requestId);b.controller.stop();
});
