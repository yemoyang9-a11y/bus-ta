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

// ─────────────────────────────────────────────
// 최신 도착정보를 앱 공통 상태에 보관한다.
//
// 시연에서 AI 는 노선 선택 직후 들은 5분을 계속 반복했다. 원인 중 하나가 이 reducer 다 —
// 서버가 3분·2분으로 갱신해 줘도 보관할 자리가 없어 화면 state 에만 남았다.
// 3초 주기 PATCH 응답에는 도착정보가 없으므로, 그대로 덮어쓰면 방금 받은 값이 지워진다.
// ─────────────────────────────────────────────

const arrivalAfter = (minutes: number) => ({
  predictedArrivalMinutes: minutes,
  occupancy: {
    type: "UNAVAILABLE",
    congestionLevel: null,
    remainingSeats: null,
  },
});

/** 대기 중 GET /status 응답 — 서버는 이때만 도착정보 네 필드를 싣는다. */
const waitingGetResponse = {
  tripStatus: "WAITING_BUS",
  boardingMethod: null,
  boardingConfirmedAt: null,
  currentStation: null,
  nextStation: null,
  remainingStations: 5,
  guideMessage: "버스 탑승을 기다리고 있습니다.",
  bellStatus: "NOT_REQUESTED",
  bellRequestId: undefined,
  command: null,
  arrivals: [arrivalAfter(3), arrivalAfter(12)],
  arrivalStatus: "AVAILABLE",
  nextArrivalRefreshInMs: 30_000,
  shouldScanBeacon: true,
};

/** 3초 주기 PATCH /status 응답 — 도착정보 네 필드가 아예 없다. */
const patchResponse = {
  tripStatus: "WAITING_BUS",
  boardingMethod: null,
  boardingConfirmedAt: null,
  currentStation: null,
  nextStation: null,
  remainingStations: 5,
  guideMessage: "버스 탑승을 기다리고 있습니다.",
  bellStatus: "NOT_REQUESTED",
  bellRequestId: undefined,
  command: null,
};

test("UPDATE_TRIP_STATUS 는 GET 응답의 최신 도착정보를 앱 공통 상태에 보관한다", () => {
  const next = tripReducer(initialState, {
    type: "UPDATE_TRIP_STATUS",
    status: waitingGetResponse,
  });

  assert.deepEqual(next.arrivals, [arrivalAfter(3), arrivalAfter(12)]);
  assert.equal(next.arrivalStatus, "AVAILABLE");
  assert.equal(next.nextArrivalRefreshInMs, 30_000);
  assert.equal(next.shouldScanBeacon, true);
});

test("도착정보가 없는 PATCH 응답은 직전 GET 의 최신 도착정보를 지우지 않는다", () => {
  const afterGet = tripReducer(initialState, {
    type: "UPDATE_TRIP_STATUS",
    status: waitingGetResponse,
  });

  const afterPatch = tripReducer(afterGet, {
    type: "UPDATE_TRIP_STATUS",
    status: patchResponse,
  });

  assert.deepEqual(afterPatch.arrivals, [arrivalAfter(3), arrivalAfter(12)]);
  assert.equal(afterPatch.arrivalStatus, "AVAILABLE");
  assert.equal(afterPatch.nextArrivalRefreshInMs, 30_000);
  assert.equal(afterPatch.shouldScanBeacon, true);
});

test("도착정보가 새로 오면 이전 값이 아니라 최신 값으로 바뀐다", () => {
  const afterGet = tripReducer(initialState, {
    type: "UPDATE_TRIP_STATUS",
    status: waitingGetResponse,
  });

  const afterRefresh = tripReducer(afterGet, {
    type: "UPDATE_TRIP_STATUS",
    status: {
      ...waitingGetResponse,
      arrivals: [arrivalAfter(2)],
    },
  });

  assert.deepEqual(afterRefresh.arrivals, [arrivalAfter(2)]);
});

test("탑승이 확정돼 대기 상태를 벗어나면 도착정보를 명시적으로 정리한다", () => {
  // 승차 정류장에 오는 차량 정보는 탑승한 뒤에는 의미가 없다. 남겨 두면 AI 가
  // 운행 중에도 "버스가 3분 뒤 도착합니다"라고 말할 근거를 갖게 된다.
  const afterGet = tripReducer(initialState, {
    type: "UPDATE_TRIP_STATUS",
    status: waitingGetResponse,
  });

  const afterBoarding = tripReducer(afterGet, {
    type: "UPDATE_TRIP_STATUS",
    status: {
      ...patchResponse,
      tripStatus: "ON_BUS",
      boardingMethod: "USER_CONFIRMED",
      boardingConfirmedAt: "2026-09-05T01:00:00.000Z",
      remainingStations: 4,
    },
  });

  assert.equal(afterBoarding.arrivals, null);
  assert.equal(afterBoarding.arrivalStatus, null);
  assert.equal(afterBoarding.nextArrivalRefreshInMs, null);
  assert.equal(afterBoarding.shouldScanBeacon, false);
});

test("CONFIRM_BOARDING 도 도착정보를 정리한다", () => {
  const afterGet = tripReducer(initialState, {
    type: "UPDATE_TRIP_STATUS",
    status: waitingGetResponse,
  });

  const afterConfirm = tripReducer(afterGet, {
    type: "CONFIRM_BOARDING",
    tripStatus: "ON_BUS",
    boardingMethod: "USER_CONFIRMED",
    boardingConfirmedAt: "2026-09-05T01:00:00.000Z",
  });

  assert.equal(afterConfirm.arrivals, null);
  assert.equal(afterConfirm.arrivalStatus, null);
  assert.equal(afterConfirm.nextArrivalRefreshInMs, null);
  assert.equal(afterConfirm.shouldScanBeacon, false);
});

test("운행을 취소하면 도착정보도 함께 비운다", () => {
  const afterGet = tripReducer(runningTripState(), {
    type: "UPDATE_TRIP_STATUS",
    status: waitingGetResponse,
  });

  const after = tripReducer(afterGet, {
    type: "RESET_TRIP_KEEP_SEARCH",
  });

  assert.equal(
    after.arrivals,
    null,
    "취소한 운행의 도착정보를 다음 선택으로 넘기지 않는다",
  );
  assert.equal(after.arrivalStatus, null);
  assert.equal(after.shouldScanBeacon, false);
});

// ─────────────────────────────────────────────
// 하차벨 연결 상태.
//
// 하차벨 연결을 탑승 확정 뒤로 옮기면서, 어떤 보드에 붙어야 하는지(targetBeaconId)와
// 붙었는지(bellConnected)를 화면 사이에서 공유해야 한다. 특히 bellConnected 의 null 은
// "실패"가 아니라 "아직 시도하지 않음"이다. 이 구분이 없으면 탑승 확정 effect 가
// 매 렌더마다 다시 연결을 시도한다.
// ─────────────────────────────────────────────

test("서버가 내려준 하차벨 보드 이름을 기억한다", () => {
  const next = tripReducer(initialState, {
    type: "SET_TARGET_BEACON_ID",
    targetBeaconId: "BUS_35_001",
  });

  assert.equal(next.targetBeaconId, "BUS_35_001");
});

test("하차벨 연결 여부는 시도 전에는 null 이다", () => {
  assert.equal(initialState.bellConnected, null);

  const connected = tripReducer(initialState, {
    type: "SET_BELL_CONNECTED",
    connected: true,
  });

  assert.equal(connected.bellConnected, true);

  const failed = tripReducer(initialState, {
    type: "SET_BELL_CONNECTED",
    connected: false,
  });

  assert.equal(failed.bellConnected, false);
});

test("운행이 끝나면 하차벨 연결 상태도 초기화된다", () => {
  const onBus = tripReducer(
    tripReducer(initialState, {
      type: "SET_TARGET_BEACON_ID",
      targetBeaconId: "BUS_35_001",
    }),
    {
      type: "SET_BELL_CONNECTED",
      connected: true,
    },
  );

  // 다음 운행은 다른 노선일 수 있다. 이전 버스의 보드 이름과 연결 상태가 남으면
  // 새 운행에서 엉뚱한 보드에 붙었다고 판단해 다시 연결하지 않는다.
  const afterCancel = tripReducer(onBus, {
    type: "RESET_TRIP_KEEP_SEARCH",
  });

  assert.equal(afterCancel.targetBeaconId, null);
  assert.equal(afterCancel.bellConnected, null);

  const afterDone = tripReducer(onBus, {
    type: "RESET_TRIP",
  });

  assert.equal(afterDone.targetBeaconId, null);
  assert.equal(afterDone.bellConnected, null);
});