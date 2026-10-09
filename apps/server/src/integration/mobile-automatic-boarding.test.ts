import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutomaticBoarding } from '../../../mobile/src/realtime/automatic-boarding.js';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(){
 let state:any={tripId:'A',tripStatus:'WAITING_BUS',targetBeaconId:'BUS_A'};let listener:any;let reject=false;let now=10000;
 const calls={requests:[] as any[],actions:[] as any[],removed:0};
 const controller=createAutomaticBoarding({tripId:'A',targetBeaconId:'BUS_A',getState:()=>state,now:()=>now,
 subscribe:(callback:any)=>{listener=callback;return()=>{calls.removed++;};},
 confirm:async(_id:string,body:any)=>{calls.requests.push(body);if(reject)throw Error();return {success:true,tripId:'A',tripStatus:'ON_BUS',boardingMethod:'AUTO_DETECTED',boardingConfirmedAt:'now',message:'confirmed',timestamp:'now'};},
 apply:(result:any)=>{calls.actions.push(result);state={...state,...result};},wait:async()=>{},onFailure:()=>{},});
 controller.start();
 return {calls,controller,setReject:(v:boolean)=>reject=v,setState:(v:any)=>state={...state,...v},sample:(rssi=-50,beaconId='BUS_A',timestamp?:number)=>{now+=1000;listener({rssi,beaconId,timestamp:timestamp??now});}};
}
test('타깃의 새 유효 표본을 7초 받은 뒤 서버 성공만 탑승 상태에 반영한다',async()=>{
 const a=setup();a.sample(NaN);a.sample(-50,'OTHER');for(let i=0;i<8;i++)a.sample();await flush();
 assert.equal(a.calls.requests.length,1);assert.equal(a.calls.requests[0].boardingMethod,'AUTO_DETECTED');assert.equal(a.calls.actions.length,1);a.controller.stop();
});
test('자동확정 네트워크 실패는 같은 requestId로3회만 시도하고 앱을 탑승으로 바꾸지 않는다',async()=>{
 const a=setup();a.setReject(true);for(let i=0;i<8;i++)a.sample();await flush();assert.equal(a.calls.requests.length,3);
 assert.equal(new Set(a.calls.requests.map(r=>r.requestId)).size,1);assert.equal(a.calls.actions.length,0);a.controller.stop();
});
test('중복/늦은 표본과 취소 뒤 callback으로 탑승 확정하지 않는다',async()=>{
 const a=setup();for(let i=0;i<8;i++)a.sample(-50,'BUS_A',11000);await flush();assert.equal(a.calls.requests.length,0);
 a.controller.stop();for(let i=0;i<8;i++)a.sample();await flush();assert.equal(a.calls.requests.length,0);assert.equal(a.calls.removed,1);
});
