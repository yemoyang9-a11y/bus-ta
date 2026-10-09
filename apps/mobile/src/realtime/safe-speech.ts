export type SpeechOptions = {
  language?: string;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
};
export type NativeSpeech = { speak: (message: string, options?: SpeechOptions) => unknown; stop: () => unknown };
const STOP_TIMEOUT_MS = 1500;

/** Shared native-output gate. A timed-out stop remains owned until it settles. */
export function createSafeSpeech(native: NativeSpeech) {
  let unsafe = false;
  let externalUnsafe = false;
  let holds = 0;
  let pendingNativeStop: Promise<void> | null = null;
  let stopping: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const externalRepairs = new Set<() => boolean>();
  const notify = () => listeners.forEach(listener => listener());
  const canSpeak = () => !unsafe && !externalUnsafe && !stopping && holds === 0;
  async function bounded(operation: Promise<void>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation.then(() => true),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  function stop(): Promise<boolean> {
    if (stopping) return stopping;
    const task = Promise.resolve().then(async () => {
      // Never issue a fresh stop while an earlier timed-out native call could
      // still complete later and cut off a replacement utterance.
      if (pendingNativeStop) {
        try { if (!await bounded(pendingNativeStop)) return false; }
        catch { /* settled failure: a fresh explicit attempt is now safe */ }
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const operation = Promise.resolve().then(() => native.stop()).then(() => undefined);
        pendingNativeStop = operation;
        void operation.then(
          () => { if (pendingNativeStop === operation) pendingNativeStop = null; },
          () => { if (pendingNativeStop === operation) pendingNativeStop = null; },
        );
        try {
          if (!await bounded(operation)) return false;
          unsafe = false;
          return !externalUnsafe;
        } catch { /* retry one explicit rejection; a hanging call is not retried */ }
      }
      return false;
    }).then(ok => {
      if (!ok) unsafe = true;
      return ok;
    }).finally(() => {
      if (stopping === task) stopping = null;
      notify();
    });
    stopping = task;
    notify();
    return task;
  }
  return {
    speak(message: string, options?: SpeechOptions): boolean {
      if (!canSpeak()) { options?.onError?.(); return false; }
      try { native.speak(message, options); return true; }
      catch { unsafe = true; notify(); options?.onError?.(); return false; }
    },
    stop,
    recover: stop,
    canSpeak,
    isUnsafe: () => unsafe || externalUnsafe,
    hold() {
      holds++; notify(); let released = false;
      return () => { if (!released) { released = true; holds--; notify(); } };
    },
    waitUntilSafe: async () => { if (stopping) await stopping; return canSpeak(); },
    blockExternal(repair?: () => boolean) {
      if (repair) externalRepairs.add(repair);
      if (!externalUnsafe) { externalUnsafe = true; notify(); }
    },
    repairExternalOutput() {
      try { for (const repair of externalRepairs) if (!repair()) return false; }
      catch { return false; }
      externalRepairs.clear();
      return true;
    },
    clearExternalBlock() { externalUnsafe = false; unsafe = true; notify(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type SafeSpeech = ReturnType<typeof createSafeSpeech>;
// Interop namespace wrappers can differ across screens; the native stop
// function is the stable identity for the shared output device.
const managers = new WeakMap<NativeSpeech['stop'], SafeSpeech>();
export function getSafeSpeech(native: NativeSpeech): SafeSpeech {
  let manager = managers.get(native.stop);
  if (!manager) { manager = createSafeSpeech(native); managers.set(native.stop, manager); }
  return manager;
}
