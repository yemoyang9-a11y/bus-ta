import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  createAssistDeviceStatusEvent,
  getAssistDeviceFallbackMessage,
  getAssistDeviceResponseInstructions,
} from '../../../mobile/src/realtime/assist-device-status.js';
import { initialState } from '../../../mobile/src/state/trip-reducer.js';
import type { AppTripState, AssistDeviceStatusChangedEvent, RealtimeGuideContext } from '../../../mobile/src/realtime/types.js';

// 모바일 세션은 모바일 tsconfig로 검사하며, 서버 테스트는 기존 화면 하네스와
// 동일하게 실제 소스를 로드해 전송 배선을 검증한다.
function createSession(context: RealtimeGuideContext) {
  const path = new URL('../../../mobile/src/realtime/session.ts', import.meta.url);
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { exports, require: createRequire(path), console, setTimeout, clearTimeout });
  return new exports.HaneumRealtimeSession(context);
}

function event(overrides: Partial<AssistDeviceStatusChangedEvent> = {}) {
  return createAssistDeviceStatusEvent({
    device: 'CANE', reason: 'NOT_CONNECTED', attempted: true, retryable: false,
    ...overrides,
  });
}

const cases: [string, Partial<AssistDeviceStatusChangedEvent>, string][] = [
  ['지팡이 재시도 가능', { retryable: true }, '지팡이에 연결하지 못했습니다. 다시 연결을 시도할 수 있습니다.'],
  ['지팡이 재시도 불가', {}, '지팡이에 연결하지 못했습니다. 버스 접근 진동 안내를 사용할 수 없습니다.'],
  ['비콘 미등록', { reason: 'BEACON_NOT_REGISTERED', attempted: false }, '이 노선의 비콘 정보가 등록되지 않아 버스 접근 진동을 준비하지 못했습니다.'],
  ['비콘 조회 재시도 가능', { reason: 'BEACON_LOOKUP_FAILED', attempted: false, retryable: true }, '비콘 정보를 불러오지 못했습니다. 다시 조회할 수 있습니다.'],
  ['비콘 조회 재시도 불가', { reason: 'BEACON_LOOKUP_FAILED', attempted: false }, '비콘 정보를 확인하지 못해 버스 접근 진동 안내를 준비하지 못했습니다.'],
  ['하차벨 재시도 불가', { device: 'BELL' }, '하차벨에 연결하지 못했습니다. 내리기 전에 기사님께 직접 말씀해 주세요.'],
  ['하차벨 재시도 가능도 안전 안내 유지', { device: 'BELL', retryable: true }, '하차벨에 연결하지 못했습니다. 다시 연결을 시도할 수 있습니다. 내리기 전에 기사님께 직접 말씀해 주세요.'],
  ['둘 다 재시도 불가', { device: 'BOTH' }, '지팡이와 하차벨에 연결하지 못했습니다. 버스 접근 진동 안내를 사용할 수 없습니다. 내리기 전에 기사님께 직접 말씀해 주세요.'],
  ['둘 다 재시도 가능', { device: 'BOTH', retryable: true }, '지팡이와 하차벨에 연결하지 못했습니다. 다시 연결을 시도할 수 있습니다. 내리기 전에 기사님께 직접 말씀해 주세요.'],
  ['연결 시도 전 실패', { attempted: false, retryable: true }, '지팡이 연결을 준비하지 못했습니다. 다시 준비를 시도할 수 있습니다.'],
  ['명령 전송 실패', { reason: 'COMMAND_FAILED' }, '지팡이에 명령을 전달하지 못했습니다. 버스 접근 진동 안내를 사용할 수 없습니다.'],
  ['명령 재전송 가능', { reason: 'COMMAND_FAILED', retryable: true }, '지팡이에 명령을 전달하지 못했습니다. 명령을 다시 전송할 수 있습니다.'],
  ['하차벨 명령 실패', { device: 'BELL', reason: 'COMMAND_FAILED' }, '하차벨에 명령을 전달하지 못했습니다. 내리기 전에 기사님께 직접 말씀해 주세요.'],
];

for (const [name, overrides, expected] of cases) {
  test(name, () => {
    const value = event(overrides);
    assert.equal(getAssistDeviceFallbackMessage(value), expected);
    assert.ok(getAssistDeviceResponseInstructions(value).endsWith(`안내 문구: ${expected}`));
    assert.doesNotMatch(expected, /전문가|전원|블루투스|시도하겠습니다|조회하겠습니다|attempted|retryable/);
    assert.ok(expected.split('.').filter(part => part.trim()).length <= 3);
  });
}

test('Realtime 실제 전송 지침에 로컬 TTS와 같은 원인별 문구를 넣고 중복을 막는다', () => {
  const context: RealtimeGuideContext = {
    getAppState: () => initialState as unknown as AppTripState,
    dispatchAppAction: () => {},
    getCurrentLocation: () => undefined,
    refreshCurrentLocation: async () => {},
  };
  const session = createSession(context);
  const sent: unknown[] = [];
  const transport = { send: (value: unknown) => sent.push(value) };
  Object.assign(session, { transport });
  const value = event({ reason: 'BEACON_LOOKUP_FAILED', attempted: false, retryable: true });
  assert.equal(session.notifyAssistDeviceStatusChange(value), true);
  const response = sent.find(item => (item as { type: string }).type === 'response.create') as { response: { instructions: string } };
  assert.ok(response);
  assert.equal(response.response.instructions, getAssistDeviceResponseInstructions(value));
  const item = sent.find(item => (item as { type: string }).type === 'conversation.item.create') as { item: { content: { text: string }[] } };
  assert.deepEqual(JSON.parse(item.item.content[0]!.text), value);
  const count = sent.length;
  session.notifyAssistDeviceStatusChange(value);
  assert.equal(sent.length, count);
});

test('Realtime 연결 전에는 기존 로컬 TTS 대체 경로를 유지한다', () => {
  const context: RealtimeGuideContext = {
    getAppState: () => initialState as unknown as AppTripState, dispatchAppAction: () => {},
    getCurrentLocation: () => undefined, refreshCurrentLocation: async () => {},
  };
  assert.equal(createSession(context).notifyAssistDeviceStatusChange(event()), false);
});
