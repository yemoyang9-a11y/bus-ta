import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTripNavigationTarget,
  isScreenTripActive,
  resetCompletedTrip,
  resetTripKeepingSearch,
} from '../apps/mobile/src/state/trip-transition.ts';
import { createSingleFlight } from '../apps/mobile/src/ble/single-flight.ts';

const initialState = {
  destination: null,
  routeCandidates: null,
  routeCandidatesExpiresAt: null,
  announcedCandidateIds: [],
  selectedRoute: null,
  tripId: null,
  tripStatus: null,
  beaconScanActive: false,
};

test('A 취소는 검색 결과와 실제 BLE 정리 대기 상태를 보존하고 후보 화면으로 전환한다', () => {
  const routeCandidates = [
    { candidateId: 1, routeNo: '100' },
    { candidateId: 2, routeNo: '200' },
  ];
  const cancelled = resetTripKeepingSearch(initialState, {
    ...initialState,
    destination: '수원역',
    routeCandidates,
    routeCandidatesExpiresAt: 2_000_000_000_000,
    announcedCandidateIds: [1, 2],
    selectedRoute: routeCandidates[0],
    tripId: 'trip-A',
    tripStatus: 'WAITING_BUS',
    beaconScanActive: true,
  });

  assert.equal(cancelled.tripId, null);
  assert.equal(cancelled.selectedRoute, null);
  assert.equal(cancelled.destination, '수원역');
  assert.equal(cancelled.routeCandidates, routeCandidates);
  assert.equal(cancelled.routeCandidatesExpiresAt, 2_000_000_000_000);
  assert.deepEqual(cancelled.announcedCandidateIds, [1, 2]);
  assert.equal(cancelled.beaconScanActive, true);
  assert.equal(getTripNavigationTarget(cancelled), 'RouteList');
  assert.equal(isScreenTripActive(cancelled.tripId, 'trip-A'), false);
});

test('B 선택 후에는 B Riding으로 전환하고 A 화면은 계속 비활성 상태다', () => {
  const selectedRoute = { candidateId: 2, routeNo: '200' };
  const tripB = {
    ...initialState,
    destination: '수원역',
    routeCandidates: [selectedRoute],
    selectedRoute,
    tripId: 'trip-B',
    tripStatus: 'WAITING_BUS',
  };

  assert.equal(getTripNavigationTarget(tripB), 'Riding');
  assert.equal(isScreenTripActive(tripB.tripId, 'trip-A'), false);
  assert.equal(isScreenTripActive(tripB.tripId, 'trip-B'), true);
});

test('정상 종료는 검색 결과를 보존하지 않는다', () => {
  const completed = resetCompletedTrip(initialState, {
    ...initialState,
    destination: '수원역',
    routeCandidates: [{ candidateId: 1 }],
    announcedCandidateIds: [1],
    tripId: 'trip-A',
    tripStatus: 'TRIP_DONE',
    beaconScanActive: true,
  });

  assert.equal(completed.destination, null);
  assert.equal(completed.routeCandidates, null);
  assert.deepEqual(completed.announcedCandidateIds, []);
  assert.equal(completed.beaconScanActive, true);
  assert.equal(getTripNavigationTarget(completed), null);
});

test('A 비콘 중지 요청이 진행 중이면 B 선택 경로도 같은 완료 Promise를 기다린다', async () => {
  const runSingleFlight = createSingleFlight();
  let taskCount = 0;
  let release;

  const first = runSingleFlight(
    () =>
      new Promise((resolve) => {
        taskCount += 1;
        release = resolve;
      }),
  );
  const second = runSingleFlight(async () => {
    taskCount += 1;
  });

  assert.equal(first, second);
  assert.equal(taskCount, 1);

  release();
  await first;

  await runSingleFlight(async () => {
    taskCount += 1;
  });
  assert.equal(taskCount, 2);
});
