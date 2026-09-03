import assert from 'node:assert/strict';
import test from 'node:test';
import { CandidateAnnouncementTracker } from '../apps/mobile/src/realtime/candidate-announcement-tracker.ts';

test('정상 응답은 response.done과 실제 오디오 종료가 모두 확인된 뒤 기록한다', () => {
  const tracker = new CandidateAnnouncementTracker();

  tracker.startResponse([1, 2]);
  tracker.handleServerEvent({ type: 'output_audio_buffer.started' });

  assert.deepEqual(
    tracker.handleServerEvent({
      type: 'response.done',
      response: { status: 'completed' },
    }),
    [],
  );
  assert.deepEqual(
    tracker.handleServerEvent({ type: 'output_audio_buffer.stopped' }),
    [1, 2],
  );
});

test('실패하거나 불완전한 응답은 오디오가 종료돼도 후보를 기록하지 않는다', () => {
  for (const status of ['failed', 'incomplete']) {
    const tracker = new CandidateAnnouncementTracker();

    tracker.startResponse([3, 4]);
    tracker.handleServerEvent({ type: 'output_audio_buffer.started' });

    assert.deepEqual(
      tracker.handleServerEvent({
        type: 'response.done',
        response: { status },
      }),
      [],
    );
    assert.deepEqual(
      tracker.handleServerEvent({ type: 'output_audio_buffer.stopped' }),
      [],
    );
  }
});

test('중단된 응답은 후보를 기록하지 않고 같은 후보의 재시도를 허용한다', () => {
  const tracker = new CandidateAnnouncementTracker();

  tracker.startResponse([5, 6]);
  tracker.handleServerEvent({ type: 'output_audio_buffer.started' });

  assert.deepEqual(
    tracker.handleServerEvent({
      type: 'response.done',
      response: { status: 'cancelled' },
    }),
    [],
  );
  assert.deepEqual(
    tracker.handleServerEvent({ type: 'output_audio_buffer.stopped' }),
    [],
  );

  tracker.startResponse([5, 6]);
  assert.deepEqual(
    tracker.handleServerEvent({
      type: 'response.done',
      response: { status: 'completed' },
    }),
    [5, 6],
  );
});

test('중복 get_next_route_candidates 응답은 같은 후보를 다시 기록하지 않는다', () => {
  const tracker = new CandidateAnnouncementTracker();

  tracker.startResponse([7, 8, 8]);
  assert.deepEqual(
    tracker.handleServerEvent({
      type: 'response.done',
      response: { status: 'completed' },
    }),
    [7, 8],
  );

  tracker.startResponse([7, 8]);
  assert.deepEqual(
    tracker.handleServerEvent({
      type: 'response.done',
      response: { status: 'completed' },
    }),
    [],
  );
});

test('새 검색은 이전 안내 기록을 초기화해 같은 candidateId도 다시 기록할 수 있다', () => {
  const tracker = new CandidateAnnouncementTracker();

  tracker.startResponse([1, 2]);
  assert.deepEqual(
    tracker.handleServerEvent({
      type: 'response.done',
      response: { status: 'completed' },
    }),
    [1, 2],
  );

  tracker.resetForNewSearch();
  tracker.startResponse([1, 2]);
  assert.deepEqual(
    tracker.handleServerEvent({
      type: 'response.done',
      response: { status: 'completed' },
    }),
    [1, 2],
  );
});
