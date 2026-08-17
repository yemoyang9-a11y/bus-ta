import assert from 'node:assert/strict';
import test from 'node:test';
import { assertActiveTripId } from '../apps/mobile/src/realtime/function-guards.ts';

test('모델이 전달한 tripId가 현재 앱 운행 ID와 같으면 허용한다', () => {
  assert.equal(assertActiveTripId('trip-123', 'trip-123'), 'trip-123');
});

test('진행 중인 운행이 없으면 tripId 호출을 차단한다', () => {
  assert.throws(
    () => assertActiveTripId('trip-123', null),
    /진행 중인 운행이 없습니다/,
  );
});

test('모델이 현재 운행과 다른 tripId를 만들면 차단한다', () => {
  assert.throws(
    () => assertActiveTripId('invented-trip', 'trip-123'),
    /현재 진행 중인 운행과 일치하지 않습니다/,
  );
});

test('비어 있는 tripId를 차단한다', () => {
  assert.throws(() => assertActiveTripId('  ', 'trip-123'), /tripId 값이 필요합니다/);
});
