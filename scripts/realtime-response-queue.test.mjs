import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeResponseQueue } from '../apps/mobile/src/realtime/response-queue.ts';
import { getRealtimeErrorDetails } from '../apps/mobile/src/realtime/server-event.ts';
import {
  HANEUM_REALTIME_READY_INSTRUCTIONS,
  createRealtimeReadyResponseEvent,
  createRealtimeSessionUpdateEvent,
} from '../apps/mobile/src/realtime/guide.ts';
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
  assert.match(HANEUM_REALTIME_READY_INSTRUCTIONS, /목적지를 말씀해주세요/);
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
