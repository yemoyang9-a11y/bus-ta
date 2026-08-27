import assert from "node:assert/strict";
import { createBoardingDetector } from "../apps/mobile/src/ble/boardingDetector.js";

const BASE_CONFIG = {
  rssiThreshold: -60,
  requiredDurationMs: 7000,
  toleratedDropCount: 2,
  maxSampleGapMs: 4000,
};

function createTrackedDetector(config = BASE_CONFIG) {
  const detector = createBoardingDetector(config);
  let confirmedResult = null;
  detector.onConfirmed((result) => {
    confirmedResult = result;
  });
  return {
    detector,
    getConfirmedResult: () => confirmedResult,
  };
}

function testConsecutiveSignalConfirms() {
  const { detector, getConfirmedResult } = createTrackedDetector();
  const start = 1000;

  detector.ingest({ rssi: -55, timestamp: start });
  detector.ingest({ rssi: -55, timestamp: start + 3000 });
  detector.ingest({ rssi: -55, timestamp: start + 7000 });

  assert.ok(getConfirmedResult(), "7초 연속 유지되면 확정되어야 한다");
  console.log("PASS: 연속 신호가 requiredDurationMs 이상 유지되면 확정된다");
}

function testLongGapDoesNotConfirm() {
  const { detector, getConfirmedResult } = createTrackedDetector();
  const start = 1000;

  detector.ingest({ rssi: -55, timestamp: start });
  // maxSampleGapMs(4000ms)보다 긴 공백 발생 후 샘플 1건만 옴
  detector.ingest({ rssi: -55, timestamp: start + 10000 });

  assert.equal(getConfirmedResult(), null, "긴 공백 후 샘플 1건만으로는 확정되면 안 된다");
  console.log("PASS: 긴 공백 후 재수신은 미확정이다");
}

function testLongGapThenFreshWindowConfirms() {
  const { detector, getConfirmedResult } = createTrackedDetector();
  const start = 1000;

  detector.ingest({ rssi: -55, timestamp: start });
  detector.ingest({ rssi: -55, timestamp: start + 10000 }); // 공백으로 리셋
  detector.ingest({ rssi: -55, timestamp: start + 13000 });
  detector.ingest({ rssi: -55, timestamp: start + 17000 }); // 리셋 시점부터 7초 경과

  assert.ok(getConfirmedResult(), "리셋 이후 새로 7초 연속 유지되면 확정되어야 한다");
  console.log("PASS: 긴 공백 후에도 새로 연속 유지되면 확정된다");
}

function testLongDropRecoveryDoesNotConfirm() {
  const { detector, getConfirmedResult } = createTrackedDetector();
  const start = 1000;

  detector.ingest({ rssi: -55, timestamp: start });
  detector.ingest({ rssi: -55, timestamp: start + 1000 });
  // 히스테리시스 허용(2회)을 넘는 3번의 연속 하락
  detector.ingest({ rssi: -80, timestamp: start + 2000 });
  detector.ingest({ rssi: -80, timestamp: start + 3000 });
  detector.ingest({ rssi: -80, timestamp: start + 4000 });
  // 회복 직후에는 아직 7초가 지나지 않음
  detector.ingest({ rssi: -55, timestamp: start + 5000 });

  assert.equal(getConfirmedResult(), null, "허용 횟수를 넘는 하락 후에는 연속 구간이 리셋되어야 한다");
  console.log("PASS: 긴 하락 후 회복은 미확정이다");
}

function testShortNoiseDropIsTolerated() {
  const { detector, getConfirmedResult } = createTrackedDetector();
  const start = 1000;

  detector.ingest({ rssi: -55, timestamp: start });
  detector.ingest({ rssi: -55, timestamp: start + 1000 });
  // 허용 횟수(2회) 이내의 짧은 노이즈 하락
  detector.ingest({ rssi: -80, timestamp: start + 2000 });
  detector.ingest({ rssi: -55, timestamp: start + 3000 });
  detector.ingest({ rssi: -55, timestamp: start + 7000 }); // 시작 시각 기준 7초 경과

  assert.ok(getConfirmedResult(), "허용 범위 내 노이즈는 무시되고 연속 구간이 유지되어야 한다");
  console.log("PASS: 짧은 노이즈 하락은 히스테리시스 범위 내에서 무시된다");
}

function testConfirmedOnceStopsFurtherCallbacks() {
  const { detector, getConfirmedResult } = createTrackedDetector();
  const start = 1000;

  detector.ingest({ rssi: -55, timestamp: start });
  detector.ingest({ rssi: -55, timestamp: start + 3000 });
  detector.ingest({ rssi: -55, timestamp: start + 7000 });
  const firstResult = getConfirmedResult();
  assert.ok(firstResult, "먼저 확정되어야 한다");

  // 확정 이후 추가 샘플이 와도 콜백이 다시 호출되지 않아야 한다
  detector.ingest({ rssi: -55, timestamp: start + 8000 });
  assert.equal(getConfirmedResult(), firstResult, "확정 이후에는 결과가 갱신되지 않아야 한다");
  console.log("PASS: 확정 이후에는 추가 판정을 하지 않는다");
}

const tests = [
  testConsecutiveSignalConfirms,
  testLongGapDoesNotConfirm,
  testLongGapThenFreshWindowConfirms,
  testLongDropRecoveryDoesNotConfirm,
  testShortNoiseDropIsTolerated,
  testConfirmedOnceStopsFurtherCallbacks,
];

let passed = 0;
let failed = 0;

for (const testFn of tests) {
  try {
    testFn();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${testFn.name}`);
    console.error(error);
  }
}

console.log(`\n${passed}/${tests.length} passed`);
if (failed > 0) {
  process.exitCode = 1;
}