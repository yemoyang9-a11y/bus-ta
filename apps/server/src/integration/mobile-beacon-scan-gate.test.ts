import assert from "node:assert/strict";
import test from "node:test";
import { canStartBeaconScan } from "../../../mobile/src/ble/beacon-scan-gate.js";

// ─────────────────────────────────────────────
// 비콘 스캔 시작 조건.
//
// 예모님 지적(2026-09-04, PR #47 P1): 서버의 스캔 시작 신호가 지팡이 준비보다 먼저
// 도착할 수 있다. 그때 startBeaconScan() 은 BLE_NOT_CONNECTED 로 실패하는데, 실패해도
// beaconScanActive 는 false 그대로이고 shouldScanBeacon 도 계속 true 라서 화면의
// effect 의존값이 바뀌지 않는다. 그러면 다시 시도되지 않고 스캔이 영영 안 켜진다.
//
// 판단을 화면에서 떼어내 여기서 고정한다. 준비 완료가 조건과 의존값에 함께 들어가야
// 신호가 먼저 와도 준비가 끝나는 순간 시작된다.
// ─────────────────────────────────────────────

const ready = {
  shouldScanBeacon: true,
  caneReady: true,
  beaconScanActive: false,
  starting: false,
};

test("서버 신호와 지팡이 준비가 모두 끝나면 스캔을 시작한다", () => {
  assert.equal(canStartBeaconScan(ready), true);
});

test("서버 신호가 지팡이 준비보다 먼저 와도 그때는 시작하지 않는다", () => {
  // 이 시점에 시작하면 BLE_NOT_CONNECTED 로 실패한다. 실패해도 상태가 바뀌지 않아
  // 재시도가 걸리지 않으므로, 아예 시작하지 않고 준비를 기다린다.
  assert.equal(canStartBeaconScan({ ...ready, caneReady: false }), false);
});

test("신호 선도착 후 지팡이 준비가 끝나면 그때 시작한다", () => {
  // 예모님이 요청한 회귀 시나리오. 준비 완료가 조건에 들어 있어야 이 전환이 생긴다.
  const beforeReady = { ...ready, caneReady: false };
  assert.equal(canStartBeaconScan(beforeReady), false);

  const afterReady = { ...beforeReady, caneReady: true };
  assert.equal(
    canStartBeaconScan(afterReady),
    true,
    "준비가 끝나는 순간 시작 조건이 참이 되어야 재시도가 걸린다",
  );
});

test("서버가 아직 켜라고 하지 않으면 준비가 끝나도 시작하지 않는다", () => {
  // 도착 5분 전이라는 서버 판단을 앱이 앞지르지 않는다.
  assert.equal(canStartBeaconScan({ ...ready, shouldScanBeacon: false }), false);
});

test("이미 스캔이 돌고 있으면 다시 시작하지 않는다", () => {
  assert.equal(canStartBeaconScan({ ...ready, beaconScanActive: true }), false);
});

test("시작 요청이 진행 중이면 겹쳐서 보내지 않는다", () => {
  assert.equal(canStartBeaconScan({ ...ready, starting: true }), false);
});
