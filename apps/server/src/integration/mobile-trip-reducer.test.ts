import assert from "node:assert/strict";
import test from "node:test";
import {
  initialState,
  tripReducer,
} from "../../../mobile/src/state/trip-reducer.js";

// ─────────────────────────────────────────────
// TripContext reducer.
//
// 예모님 지적(2026-09-04, PR #47 P1): RESET_TRIP_KEEP_SEARCH 가
// resetTripKeepingSearch 를 import 없이 호출하고 있었다. 사용자가 운행을 취소하면
// ReferenceError 가 나면서 tripId 가 초기화되지 않는다. 그러면 비콘 스캔 재시도의
// isStillWanted() 가 "취소됐다"를 보지 못해 "취소되면 더 시도하지 않는다" 보장이
// 실제 앱에서 깨진다. controller 단위 테스트는 이 경로를 타지 않아 CI 가 통과했다.
// ─────────────────────────────────────────────

/** 운행 중이고 비콘 스캔도 켜져 있는 상태. 취소 직전 모습이다. */
function runningTripState() {
  return {
    ...initialState,
    destination: "고색역",
    routeCandidates: [{ candidateId: 1 }, { candidateId: 2 }],
    routeCandidatesExpiresAt: 1_800_000_000_000,
    announcedCandidateIds: [1],
    selectedRoute: { candidateId: 1 },
    tripId: "trip-a",
    tripStatus: "WAITING_BUS",
    beaconScanActive: true,
    caneReady: true,
  };
}

test("취소해도 예외 없이 tripId 와 caneReady 가 초기화된다", () => {
  const before = runningTripState();

  const after = tripReducer(before, { type: "RESET_TRIP_KEEP_SEARCH" });

  assert.equal(after.tripId, null, "취소했으면 활성 운행이 없어야 한다");
  assert.equal(after.tripStatus, null);
  assert.equal(
    after.caneReady,
    false,
    "다음 운행에서 지팡이를 다시 준비해야 하므로 준비 완료를 남기지 않는다",
  );
  assert.equal(after.selectedRoute, null);
});

test("취소해도 검색 결과와 안내 기록은 유지한다", () => {
  // 예외상황 2번. 취소한 뒤 다시 검색하지 않고 기존 후보에서 고를 수 있어야 한다.
  const before = runningTripState();

  const after = tripReducer(before, { type: "RESET_TRIP_KEEP_SEARCH" });

  assert.equal(after.destination, "고색역");
  assert.deepEqual(after.routeCandidates, before.routeCandidates);
  assert.equal(after.routeCandidatesExpiresAt, before.routeCandidatesExpiresAt);
  assert.deepEqual(after.announcedCandidateIds, [1]);
});

test("취소해도 실제 스캔이 꺼지기 전까지 beaconScanActive 는 유지한다", () => {
  // 상태를 먼저 끄면 화면의 종료 경로가 "이미 꺼졌다"고 보고 실제 stopBeaconScan()
  // 을 부르지 않는다. 지팡이는 켜진 채 남는다.
  const before = runningTripState();

  const after = tripReducer(before, { type: "RESET_TRIP_KEEP_SEARCH" });

  assert.equal(after.beaconScanActive, true);
});

test("운행 종료는 검색 결과까지 비우고 스캔 상태만 남긴다", () => {
  // TRIP_DONE·TRIP_NOT_FOUND 경로. 취소와 달리 후보를 유지하지 않는다.
  const before = runningTripState();

  const after = tripReducer(before, { type: "RESET_TRIP" });

  assert.equal(after.tripId, null);
  assert.equal(after.caneReady, false);
  assert.equal(after.destination, null);
  assert.equal(after.routeCandidates, null);
  assert.equal(after.beaconScanActive, true, "실제 중지 성공 전까지는 유지한다");
});

test("지팡이 준비 완료와 스캔 시작 신호를 각각 기록한다", () => {
  const ready = tripReducer(initialState, { type: "SET_CANE_READY", ready: true });
  assert.equal(ready.caneReady, true);

  const scanning = tripReducer(ready, {
    type: "SET_BEACON_SCAN_ACTIVE",
    active: true,
  });
  assert.equal(scanning.beaconScanActive, true);
  assert.equal(scanning.caneReady, true, "스캔 시작이 준비 상태를 지우지 않는다");
});
