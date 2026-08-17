import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocationRefreshCoordinator } from '../apps/mobile/src/realtime/location-refresh.ts';

const GRANTED = async () => 'granted';
const LOCATION_A = { latitude: 37.1, longitude: 127.1 };
const LOCATION_B = { latitude: 37.2, longitude: 127.2 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(initialLocation) {
  let currentLocation = initialLocation;
  const refreshLocation = createLocationRefreshCoordinator({
    setLocation: (location) => {
      currentLocation = location;
    },
  });

  return {
    refreshLocation,
    getCurrentLocation: () => currentLocation,
  };
}

test('마운트 요청 실패 후 connect 요청 성공 좌표를 유지한다', async () => {
  const mountPosition = deferred();
  const harness = createHarness(undefined);

  const mountRefresh = harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: () => mountPosition.promise,
  });
  const connectRefresh = harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: async () => LOCATION_B,
  });

  await connectRefresh;
  mountPosition.reject(new Error('mount location failed'));
  await assert.rejects(mountRefresh, /mount location failed/);

  assert.deepEqual(harness.getCurrentLocation(), LOCATION_B);
});

test('마운트 요청 성공 후 connect 요청이 실패해도 성공 좌표를 유지한다', async () => {
  const mountPosition = deferred();
  const connectPosition = deferred();
  const harness = createHarness(undefined);

  const mountRefresh = harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: () => mountPosition.promise,
  });
  const connectRefresh = harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: () => connectPosition.promise,
  });

  mountPosition.resolve(LOCATION_A);
  await mountRefresh;
  connectPosition.reject(new Error('connect location failed'));
  await assert.rejects(connectRefresh, /connect location failed/);

  assert.deepEqual(harness.getCurrentLocation(), LOCATION_A);
});

test('늦게 끝난 실패 요청이 먼저 저장된 성공 좌표를 지우지 않는다', async () => {
  const lateFailure = deferred();
  const harness = createHarness(LOCATION_A);

  const failingRefresh = harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: () => lateFailure.promise,
  });
  await harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: async () => LOCATION_B,
  });

  lateFailure.reject(new Error('late failure'));
  await assert.rejects(failingRefresh, /late failure/);

  assert.deepEqual(harness.getCurrentLocation(), LOCATION_B);
});

test('더 오래된 성공 결과가 최신 성공 좌표를 덮지 않는다', async () => {
  const oldPosition = deferred();
  const harness = createHarness(undefined);

  const oldRefresh = harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: () => oldPosition.promise,
  });
  await harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: async () => LOCATION_B,
  });

  oldPosition.resolve(LOCATION_A);
  await oldRefresh;

  assert.deepEqual(harness.getCurrentLocation(), LOCATION_B);
});

test('가장 최신 요청에서 위치 권한이 거부되면 좌표를 비운다', async () => {
  const harness = createHarness(LOCATION_A);

  await harness.refreshLocation({
    requestPermission: async () => 'denied',
    getPosition: async () => LOCATION_B,
  });

  assert.equal(harness.getCurrentLocation(), undefined);
});

test('오래된 권한 거부 결과가 더 최신 성공 좌표를 지우지 않는다', async () => {
  const oldPermission = deferred();
  const harness = createHarness(LOCATION_A);

  const oldRefresh = harness.refreshLocation({
    requestPermission: () => oldPermission.promise,
    getPosition: async () => LOCATION_A,
  });
  await harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: async () => LOCATION_B,
  });

  oldPermission.resolve('denied');
  await oldRefresh;

  assert.deepEqual(harness.getCurrentLocation(), LOCATION_B);
});

test('최신 권한 거부보다 먼저 시작한 요청의 늦은 성공을 무시한다', async () => {
  const oldPosition = deferred();
  const harness = createHarness(LOCATION_A);

  const oldRefresh = harness.refreshLocation({
    requestPermission: GRANTED,
    getPosition: () => oldPosition.promise,
  });
  await harness.refreshLocation({
    requestPermission: async () => 'denied',
    getPosition: async () => LOCATION_B,
  });

  oldPosition.resolve(LOCATION_B);
  await oldRefresh;

  assert.equal(harness.getCurrentLocation(), undefined);
});
