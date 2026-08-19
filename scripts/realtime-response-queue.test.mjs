import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeResponseQueue } from '../apps/mobile/src/realtime/response-queue.ts';
import { getRealtimeErrorDetails } from '../apps/mobile/src/realtime/server-event.ts';

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
