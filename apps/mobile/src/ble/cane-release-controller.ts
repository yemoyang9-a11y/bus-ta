type Dependencies = { stop: () => Promise<void>; disconnect: () => Promise<void>; onStopped: () => void; wait?: (ms: number) => Promise<void> };
export async function releaseCane(d: Dependencies): Promise<boolean> {
  const wait=d.wait ?? ((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  let stopped=false;
  for(let attempt=1;attempt<=3;attempt++) {
    try { await d.stop();stopped=true;d.onStopped();break; }
    catch { if(attempt<3)await wait(attempt*1000); }
  }
  if(!stopped)return false;
  for(let attempt=1;attempt<=3;attempt++) {
    try {await d.disconnect();return true;}
    catch {if(attempt<3)await wait(attempt*1000);}
  }
  return false;
}
