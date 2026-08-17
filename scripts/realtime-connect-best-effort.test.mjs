import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectWithBestEffortLocation,
  runSingleFlight,
} from '../apps/mobile/src/realtime/connect-best-effort.ts';

test('위치 조회 성공과 WebRTC 연결을 독립적으로 진행한다', async () => {
  let finishLocation;
  let locationUpdated = false;
  let connectCount = 0;

  const locationPromise = new Promise((resolve) => {
    finishLocation = () => {
      locationUpdated = true;
      resolve();
    };
  });

  const transport = await connectWithBestEffortLocation({
    refreshCurrentLocation: () => locationPromise,
    connectWebRTC: async () => {
      connectCount += 1;
      return { id: 'transport' };
    },
  });

  assert.deepEqual(transport, { id: 'transport' });
  assert.equal(connectCount, 1);
  assert.equal(locationUpdated, false, '위치 완료를 기다리지 않고 WebRTC가 연결돼야 한다');

  finishLocation();
  await locationPromise;
  assert.equal(locationUpdated, true);
});

test('위치 권한 거부처럼 위치 갱신이 결과 없이 끝나도 WebRTC를 연결한다', async () => {
  let connectCount = 0;

  await connectWithBestEffortLocation({
    refreshCurrentLocation: async () => {},
    connectWebRTC: async () => {
      connectCount += 1;
      return undefined;
    },
  });

  assert.equal(connectCount, 1);
});

test('위치 조회 오류를 격리하고 WebRTC를 연결한다', async () => {
  let connectCount = 0;

  await connectWithBestEffortLocation({
    refreshCurrentLocation: async () => {
      throw new Error('location unavailable');
    },
    connectWebRTC: async () => {
      connectCount += 1;
      return undefined;
    },
  });

  await Promise.resolve();
  assert.equal(connectCount, 1);
});

test('위치 조회가 끝나지 않아도 WebRTC 연결 Promise는 완료된다', async () => {
  let connectCount = 0;
  const neverResolvingLocation = new Promise(() => {});

  const transport = await connectWithBestEffortLocation({
    refreshCurrentLocation: () => neverResolvingLocation,
    connectWebRTC: async () => {
      connectCount += 1;
      return { id: 'transport' };
    },
  });

  assert.deepEqual(transport, { id: 'transport' });
  assert.equal(connectCount, 1);
});

test('연속 연결 호출은 진행 중인 같은 Promise를 재사용한다', async () => {
  let finishConnect;
  let connectCount = 0;
  const promiseRef = { current: null };

  const operation = () => {
    connectCount += 1;
    return new Promise((resolve) => {
      finishConnect = resolve;
    });
  };

  const first = runSingleFlight(promiseRef, operation);
  const second = runSingleFlight(promiseRef, operation);

  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(connectCount, 1);

  finishConnect('connected');
  assert.equal(await first, 'connected');
  assert.equal(promiseRef.current, null);
});

test('연결 실패 후에는 다음 연결을 다시 시도할 수 있다', async () => {
  let connectCount = 0;
  const promiseRef = { current: null };

  await assert.rejects(
    runSingleFlight(promiseRef, async () => {
      connectCount += 1;
      throw new Error('connection failed');
    }),
    /connection failed/,
  );

  await runSingleFlight(promiseRef, async () => {
    connectCount += 1;
  });

  assert.equal(connectCount, 2);
  assert.equal(promiseRef.current, null);
});
