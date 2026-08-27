import assert from "node:assert/strict";
import test from "node:test";
import {
  ARRIVAL_POLL_MAX_MS,
  ARRIVAL_POLL_MIN_MS,
  BEACON_SCAN_TRIGGER_MINUTES,
  nextArrivalPollDelayMs,
  shouldScanBeacon,
} from "./arrival-poll-policy.js";

const MINUTE = 60_000;

test("멀리 있는 버스는 최대 간격(5분)으로만 확인한다", () => {
  assert.equal(nextArrivalPollDelayMs(30), ARRIVAL_POLL_MAX_MS);
  assert.equal(nextArrivalPollDelayMs(12), ARRIVAL_POLL_MAX_MS);
  // 10분의 절반이 정확히 상한이다.
  assert.equal(nextArrivalPollDelayMs(10), ARRIVAL_POLL_MAX_MS);
});

test("가까워지면 남은 시간의 절반으로 좁힌다", () => {
  assert.equal(nextArrivalPollDelayMs(8), 4 * MINUTE);
  assert.equal(nextArrivalPollDelayMs(5), 2.5 * MINUTE);
  assert.equal(nextArrivalPollDelayMs(2), 1 * MINUTE);
});

test("도착 직전에도 최소 간격(20초)보다 자주 부르지 않는다", () => {
  assert.equal(nextArrivalPollDelayMs(0.5), ARRIVAL_POLL_MIN_MS);
  assert.equal(nextArrivalPollDelayMs(0), ARRIVAL_POLL_MIN_MS);
});

test("예측값이 실시간의 1.5배로 줄어도 다음 조회 전에 도착하지 않는다", () => {
  // 실측된 최악 감소 속도(러시아워 210번: 4분 동안 6분 감소)를 적용한다.
  const WORST_RATE = 1.5;

  for (const remaining of [30, 20, 10, 8, 5, 3, 2, 1]) {
    const waitedMinutes = nextArrivalPollDelayMs(remaining) / MINUTE;
    const remainingAtNextPoll = remaining - waitedMinutes * WORST_RATE;

    assert.ok(
      remainingAtNextPoll > 0,
      `${remaining}분 남은 상태에서 ${waitedMinutes}분 기다리면 도착을 지나친다`,
    );
  }
});

test("도착정보가 없으면 조회를 멈추지 않고 최대 간격으로 재시도한다", () => {
  assert.equal(nextArrivalPollDelayMs(null), ARRIVAL_POLL_MAX_MS);
  assert.equal(nextArrivalPollDelayMs(Number.NaN), ARRIVAL_POLL_MAX_MS);
});

test("5분 이내로 들어오면 비콘 스캔을 시작한다", () => {
  assert.equal(shouldScanBeacon(BEACON_SCAN_TRIGGER_MINUTES), true);
  assert.equal(shouldScanBeacon(3), true);
  assert.equal(shouldScanBeacon(0), true);
});

test("아직 멀면 비콘 스캔을 켜지 않는다", () => {
  assert.equal(shouldScanBeacon(6), false);
  assert.equal(shouldScanBeacon(30), false);
});

test("앞차가 떠나 도착시간이 다시 늘어나도 스캔을 끄지 않는다", () => {
  // 실측 720-2번: 1분 → 9분. 여기서 스캔을 끄면 정작 버스가 온 순간 꺼져 있다.
  assert.equal(shouldScanBeacon(9, true), true);
  assert.equal(shouldScanBeacon(30, true), true);
});

test("도착정보를 확인할 수 없으면 스캔을 켠다", () => {
  // GBIS 미수록 노선이나 실시간 값이 빈 경우. 여기서 막으면 자동 탑승 판정이
  // 영영 시작되지 않는다. 배터리보다 탑승을 놓치지 않는 쪽을 택한다.
  assert.equal(shouldScanBeacon(null), true);
  assert.equal(shouldScanBeacon(Number.NaN), true);
});

test("한 번 켜진 스캔은 어떤 값에도 꺼지지 않는다", () => {
  for (const value of [null, Number.NaN, 0, 5, 60, 200]) {
    assert.equal(shouldScanBeacon(value, true), true, `value=${String(value)}에서 꺼졌다`);
  }
});
