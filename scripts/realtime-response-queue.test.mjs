import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeResponseQueue } from '../apps/mobile/src/realtime/response-queue.ts';
import { getRealtimeErrorDetails } from '../apps/mobile/src/realtime/server-event.ts';
import {
  HANEUM_REALTIME_READY_INSTRUCTIONS,
  HANEUM_REALTIME_INSTRUCTIONS,
  createRealtimeReadyResponseEvent,
  createRealtimeSessionUpdateEvent,
} from '../apps/mobile/src/realtime/guide.ts';
import {
  ASSIST_DEVICE_RESPONSE_INSTRUCTIONS,
  createAssistDeviceConnectionFailureEvents,
  createAssistDeviceStatusEvent,
  createBeaconLookupFailureEvent,
  getAssistDeviceFallbackMessage,
  getAssistDeviceEventKey,
} from '../apps/mobile/src/realtime/assist-device-status.ts';
import { createAssistDevicePreparation } from '../apps/mobile/src/realtime/assist-device-preparation.ts';
import {
  RealtimeConnectionTimeoutError,
  runWithRealtimeConnectionTimeout,
} from '../apps/mobile/src/realtime/connection-timeout.ts';

let eventId = 0;

function response(label) {
  return {
    eventId: `test_${++eventId}`,
    instructions: label,
    precedingEvents: [{ label }],
  };
}

function status(overrides = {}) {
  return {
    type: 'trip_status_changed',
    tripStatus: 'ON_BUS',
    remainingStations: 5,
    currentStationName: '현재 정류장',
    bellStatus: 'NOT_REQUESTED',
    guideMessage: null,
    ...overrides,
  };
}

test('일반 운행 상태는 대기열에 누적하지 않고 최신 한 건만 유지한다', () => {
  const queue = new RealtimeResponseQueue();

  queue.enqueueStatus(response('5정거장'), status({ remainingStations: 5 }), 'trip-1');
  queue.enqueueStatus(response('4정거장'), status({ remainingStations: 4 }), 'trip-1');
  queue.enqueueStatus(response('3정거장'), status({ remainingStations: 3 }), 'trip-1');

  assert.equal(queue.dequeue()?.instructions, '3정거장');
  assert.equal(queue.dequeue(), undefined);
});

test('하차 2·1정거장 전, 하차벨 결과와 도착 안내는 순서대로 보존한다', () => {
  const queue = new RealtimeResponseQueue();

  queue.enqueueStatus(response('2정거장'), status({ remainingStations: 2 }), 'trip-1');
  queue.enqueueStatus(response('1정거장'), status({ remainingStations: 1 }), 'trip-1');
  queue.enqueueStatus(
    response('벨 성공'),
    status({ remainingStations: 1, bellStatus: 'SUCCESS' }),
    'trip-1',
  );
  queue.enqueueStatus(
    response('도착'),
    status({ tripStatus: 'TRIP_DONE', remainingStations: 0 }),
    'trip-1',
  );

  assert.deepEqual(
    [queue.dequeue(), queue.dequeue(), queue.dequeue(), queue.dequeue()].map(
      (item) => item?.instructions,
    ),
    ['2정거장', '1정거장', '벨 성공', '도착'],
  );
});

test('아직 안내되지 않은 같은 중요 이벤트는 최신 서버 상태로 교체한다', () => {
  const queue = new RealtimeResponseQueue();

  queue.enqueueStatus(response('1정거장 이전 값'), status({ remainingStations: 1 }), 'trip-1');
  queue.enqueueStatus(response('1정거장 최신 값'), status({ remainingStations: 1 }), 'trip-1');

  assert.equal(queue.dequeue()?.instructions, '1정거장 최신 값');

  queue.enqueueStatus(response('1정거장 반복'), status({ remainingStations: 1 }), 'trip-1');
  assert.equal(queue.dequeue(), undefined, '이미 안내한 중요 이벤트를 반복하면 안 된다');
});

test('Function 응답은 일반 상태와 달리 모두 보존한다', () => {
  const queue = new RealtimeResponseQueue();

  queue.enqueueDirect(response('경로 검색 결과'));
  queue.enqueueStatus(response('5정거장'), status({ remainingStations: 5 }), 'trip-1');
  queue.enqueueDirect(response('운행 생성 결과'));
  queue.enqueueStatus(response('4정거장'), status({ remainingStations: 4 }), 'trip-1');

  assert.deepEqual(
    [queue.dequeue(), queue.dequeue(), queue.dequeue()].map((item) => item?.instructions),
    ['경로 검색 결과', '운행 생성 결과', '4정거장'],
  );
});

test('새 운행이 시작되면 이전 운행의 대기 상태 안내만 제거한다', () => {
  const queue = new RealtimeResponseQueue();

  queue.enqueueDirect(response('사용자 Function 응답'));
  queue.enqueueStatus(response('이전 운행 2정거장'), status({ remainingStations: 2 }), 'trip-1');
  queue.enqueueStatus(response('새 운행 5정거장'), status({ remainingStations: 5 }), 'trip-2');

  assert.equal(queue.dequeue()?.instructions, '사용자 Function 응답');
  assert.equal(queue.dequeue()?.instructions, '새 운행 5정거장');
  assert.equal(queue.dequeue(), undefined);
});

test('Realtime 오류에서 원인 클라이언트 event_id를 error 객체 안에서 읽는다', () => {
  assert.deepEqual(
    getRealtimeErrorDetails({
      type: 'error',
      event_id: 'server-event-id',
      error: {
        code: 'conversation_already_has_active_response',
        event_id: 'resp_7',
      },
    }),
    {
      code: 'conversation_already_has_active_response',
      clientEventId: 'resp_7',
    },
  );
});

test('Realtime 세션은 음성 오인식이 진행 중인 응답을 끊지 않도록 설정한다', () => {
  const update = createRealtimeSessionUpdateEvent();

  assert.deepEqual(update.session.audio.input, {
    noise_reduction: {
      type: 'near_field',
    },
    turn_detection: {
      type: 'semantic_vad',
      eagerness: 'low',
      create_response: true,
      interrupt_response: false,
    },
  });
});

test('연결 성공 안내는 Realtime 응답 한 건으로 생성한다', () => {
  assert.deepEqual(createRealtimeReadyResponseEvent(), {
    type: 'response.create',
    response: {
      instructions: HANEUM_REALTIME_READY_INSTRUCTIONS,
    },
  });
  assert.match(HANEUM_REALTIME_READY_INSTRUCTIONS, /버스 도우미 앱입니다/);
  assert.match(HANEUM_REALTIME_READY_INSTRUCTIONS, /어디로 가실 건가요/);
});

test('버스를 놓친 발화는 도착정보 강제 갱신으로 보내고 운행을 종료하지 않는다', () => {
  assert.match(HANEUM_REALTIME_INSTRUCTIONS, /버스 놓쳤어요/);
  assert.match(HANEUM_REALTIME_INSTRUCTIONS, /refreshArrivals를 true/);
  assert.match(HANEUM_REALTIME_INSTRUCTIONS, /end_trip을 호출하지 않는다/);
  assert.match(HANEUM_REALTIME_INSTRUCTIONS, /일반 도착 질문에서는 refreshArrivals를 생략하거나 false/);
});

test('보조기기 실패 이벤트는 시도 여부와 재시도 가능 여부를 보존한다', () => {
  const event = createAssistDeviceStatusEvent({
    device: 'BOTH',
    reason: 'BEACON_NOT_REGISTERED',
    attempted: false,
    retryable: false,
  });

  assert.deepEqual(event, {
    type: 'assist_device_status_changed',
    device: 'BOTH',
    status: 'UNAVAILABLE',
    reason: 'BEACON_NOT_REGISTERED',
    attempted: false,
    retryable: false,
  });
  assert.equal(
    getAssistDeviceEventKey('trip-1', event),
    'trip-1:BOTH:UNAVAILABLE:BEACON_NOT_REGISTERED:false:false',
  );
  assert.match(ASSIST_DEVICE_RESPONSE_INSTRUCTIONS, /attempted가 false/);
  assert.match(ASSIST_DEVICE_RESPONSE_INSTRUCTIONS, /retryable이 false/);
  assert.match(ASSIST_DEVICE_RESPONSE_INSTRUCTIONS, /기사님께 직접 말씀/);
});

test('비콘 미등록과 일시적 조회 실패를 재시도 가능 여부로 구분한다', () => {
  const notRegistered = createBeaconLookupFailureEvent('BEACON_NOT_FOUND');
  const lookupFailed = createBeaconLookupFailureEvent('DB_ERROR');

  assert.equal(notRegistered.reason, 'BEACON_NOT_REGISTERED');
  assert.equal(notRegistered.device, 'CANE');
  assert.equal(notRegistered.attempted, false);
  assert.equal(notRegistered.retryable, false);
  assert.equal(lookupFailed.reason, 'BEACON_LOOKUP_FAILED');
  assert.equal(lookupFailed.device, 'CANE');
  assert.equal(lookupFailed.attempted, false);
  assert.equal(lookupFailed.retryable, true);
  assert.doesNotMatch(getAssistDeviceFallbackMessage(notRegistered), /전원/);
});

test('지팡이와 하차벨 연결 결과를 개별 또는 BOTH 이벤트로 만든다', () => {
  assert.deepEqual(createAssistDeviceConnectionFailureEvents(true, true), []);
  assert.equal(createAssistDeviceConnectionFailureEvents(false, false)[0]?.device, 'BOTH');
  assert.equal(createAssistDeviceConnectionFailureEvents(false, true)[0]?.device, 'CANE');
  assert.equal(createAssistDeviceConnectionFailureEvents(true, false)[0]?.device, 'BELL');
});

test('운행이 시작되면 보조기기 준비를 한 번 실행한다', async () => {
  let activeTripId = 'trip-voice';
  let beaconLookupCount = 0;
  let connectCount = 0;
  const dispatches = [];

  const preparation = createAssistDevicePreparation({
    getActiveTripId: () => activeTripId,
    listBeacons: async () => {
      beaconLookupCount += 1;
      return { targetBeaconId: 'BUS_1551_001', isMock: false };
    },
    connectAll: async () => {
      connectCount += 1;
      return new Map([
        ['White_cane', {}],
        ['BUS_1551_001', {}],
      ]);
    },
    setTargetBeacon: async () => {},
    startBeaconScan: async () => {},
    notifyFailure: () => {},
    dispatch: (action) => dispatches.push(action),
  });

  await Promise.all([
    preparation.prepare({ tripId: 'trip-voice', routeNo: '13' }),
    preparation.prepare({ tripId: 'trip-voice', routeNo: '13' }),
  ]);

  assert.equal(beaconLookupCount, 1);
  assert.equal(connectCount, 1);
  assert.deepEqual(dispatches, [
    { type: 'SET_BEACON_SCAN_ACTIVE', active: true },
    { type: 'SET_BLE_MOCK_STATUS', isMock: false },
  ]);
});

test('이전 운행의 늦은 보조기기 결과는 새 운행에 반영하지 않는다', async () => {
  let activeTripId = 'trip-a';
  let releaseFirstConnection;
  let connectCount = 0;
  const dispatches = [];
  const notifications = [];

  const preparation = createAssistDevicePreparation({
    getActiveTripId: () => activeTripId,
    listBeacons: async () => ({ targetBeaconId: 'BUS_1551_001', isMock: false }),
    connectAll: () => {
      connectCount += 1;
      if (connectCount === 1) {
        return new Promise((resolve) => {
          releaseFirstConnection = resolve;
        });
      }
      return Promise.resolve(new Map([
        ['White_cane', {}],
        ['BUS_1551_001', {}],
      ]));
    },
    setTargetBeacon: async () => {},
    startBeaconScan: async () => {},
    notifyFailure: (event) => notifications.push(event),
    dispatch: (action) => dispatches.push(action),
  });

  const first = preparation.prepare({ tripId: 'trip-a', routeNo: '13' });
  await new Promise((resolve) => setImmediate(resolve));
  activeTripId = 'trip-b';
  const second = preparation.prepare({ tripId: 'trip-b', routeNo: '13' });
  releaseFirstConnection(new Map());

  await Promise.all([first, second]);

  assert.equal(connectCount, 2);
  assert.deepEqual(notifications, []);
  assert.deepEqual(dispatches, [
    { type: 'SET_BEACON_SCAN_ACTIVE', active: true },
    { type: 'SET_BLE_MOCK_STATUS', isMock: false },
  ]);
});

test('전체 연결 제한 시간이 지나면 작업을 중단하고 재시도 가능한 오류를 반환한다', async () => {
  let wasAborted = false;

  await assert.rejects(
    runWithRealtimeConnectionTimeout(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            wasAborted = true;
          });
          setTimeout(resolve, 100);
        }),
      5,
    ),
    RealtimeConnectionTimeoutError,
  );

  assert.equal(wasAborted, true);
});

test('전체 연결이 제한 시간 안에 끝나면 결과를 그대로 반환한다', async () => {
  const result = await runWithRealtimeConnectionTimeout(async () => 'connected', 50);
  assert.equal(result, 'connected');
});
