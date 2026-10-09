import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createVoiceRouteDiagnostic } from '../apps/mobile/src/realtime/voice-route-diagnostic.js';

test('voice route diagnostics omit raw arguments, identifiers, utterances and location', () => {
  const fields = { tool: 'end_trip', phase: 'WAITING_BUS', success: true, hasTrip: true,
    missedBus: true, cancelRequested: true, arguments: 'secret', tripId: 'secret',
    utterance: 'secret', latitude: 37, token: 'secret' };
  assert.deepEqual(createVoiceRouteDiagnostic('function_received', fields), {
    stage: 'function_received', tool: 'end_trip', phase: 'WAITING_BUS', success: true,
    hasTrip: true, missedBus: true, cancelRequested: true,
  });
  assert.deepEqual(createVoiceRouteDiagnostic('policy_ack', {
    tool: 'secret', phase: 'secret', policy: 'secret', screen: 'secret',
  }), { stage: 'policy_ack' });
});

for (const enabled of [true, false, undefined]) test(`voice route logging is development only: ${enabled}`, () => {
  const logs: unknown[] = []; const exports: Record<string, any> = {};
  const source = readFileSync(new URL('../apps/mobile/src/realtime/voice-route-diagnostic.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, ...(enabled === undefined ? {} : { __DEV__: enabled }), console: { info: (...args: unknown[]) => logs.push(args) } });
  exports.logVoiceRouteDiagnostic('policy_ack', { policy: 'confirmed' });
  assert.equal(logs.length, enabled === true ? 1 : 0);
});
