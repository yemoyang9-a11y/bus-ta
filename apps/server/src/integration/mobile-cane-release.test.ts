import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseCane } from '../../../mobile/src/ble/cane-release-controller.js';
test('STOP 실패는 연결을 보존하고 disconnect 실패 뒤 STOP부터 재시도할 수 있다',async()=>{
 let disconnects=0;let failStop=true;let failDisconnect=true;const order:string[]=[];
 const deps={stop:async()=>{order.push('STOP');if(failStop)throw Error();},disconnect:async()=>{disconnects++;order.push('disconnect');if(failDisconnect)throw Error();},onStopped:()=>{},wait:async()=>{}};
 assert.equal(await releaseCane(deps),false);assert.equal(disconnects,0);
 failStop=false;assert.equal(await releaseCane(deps),false);assert.equal(disconnects,3);
 failDisconnect=false;assert.equal(await releaseCane(deps),true);assert.deepEqual(order.slice(-2),['STOP','disconnect']);
});
