import { createBoardingDetector } from '../ble/boardingDetector';
import type { BoardingConfirmationRequest, BoardingConfirmationResponse } from '@bus-ta/shared';
import type { AppTripState } from './types';
type Sample = { rssi: number; beaconId?: string; timestamp?: number; sampleId?: number };
type Dependencies = {
  tripId: string; targetBeaconId: string;
  getState: () => Pick<AppTripState, 'tripId' | 'tripStatus'> & {targetBeaconId?: string | null};
  subscribe: (callback: (sample: Sample) => void) => () => void;
  confirm: (tripId: string, request: BoardingConfirmationRequest) => Promise<BoardingConfirmationResponse>;
  apply: (result: BoardingConfirmationResponse) => void;
  onFailure: () => void; wait?: (ms: number) => Promise<void>; now?: () => number;
};
let sequence=0;
export function createAutomaticBoarding(d: Dependencies) {
  const detector=createBoardingDetector();
  const now=d.now ?? Date.now;
  let stopped=false, confirming=false, unsubscribe:(()=>void)|null=null;
  let lastTimestamp=-Infinity, lastSampleId=-Infinity;
  let cancelWait:(()=>void)|null=null;
  const wait=d.wait ?? ((ms:number)=>new Promise<void>(resolve=>{
    const timer=setTimeout(()=>{cancelWait=null;resolve();},ms);
    cancelWait=()=>{clearTimeout(timer);cancelWait=null;resolve();};
  }));
  const wanted=()=>!stopped && d.getState().tripId===d.tripId && d.getState().tripStatus==='WAITING_BUS' && d.getState().targetBeaconId===d.targetBeaconId;
  detector.onConfirmed(async ({ detectedAt }) => {
    if (!wanted() || confirming) return;
    confirming=true;
    const requestId=`auto-boarding-${d.tripId}-${now()}-${++sequence}`;
    for(let attempt=1;attempt<=3 && wanted();attempt++) {
      try {
        const result=await d.confirm(d.tripId,{requestId,boardingMethod:'AUTO_DETECTED',detectedAt});
        if(wanted() && result.success && result.tripId===d.tripId) d.apply(result);
        return;
      } catch {
        if(!wanted()) return;
        if(attempt===3) { d.onFailure(); return; }
        await wait(attempt*1000);
      }
    }
  });
  return {
    start() {
      if(!wanted() || unsubscribe) return;
      try {
        unsubscribe=d.subscribe(sample=>{
          if(!wanted() || confirming || sample.beaconId!==d.targetBeaconId || !Number.isFinite(sample.rssi) || sample.rssi>=0 || sample.rssi < -127) return;
          const timestamp=sample.timestamp;
          if(typeof timestamp!=='number' || !Number.isFinite(timestamp) || timestamp<=lastTimestamp || timestamp>now() || now()-timestamp>4000) return;
          if(sample.sampleId!==undefined && (!Number.isFinite(sample.sampleId) || sample.sampleId<=lastSampleId)) return;
          lastTimestamp=timestamp;if(sample.sampleId!==undefined)lastSampleId=sample.sampleId;
          detector.ingest({rssi:sample.rssi,beaconId:sample.beaconId,timestamp});
        });
      } catch { d.onFailure(); }
    },
    stop() { if(stopped)return;stopped=true;cancelWait?.();unsubscribe?.();unsubscribe=null;detector.reset(); },
  };
}
