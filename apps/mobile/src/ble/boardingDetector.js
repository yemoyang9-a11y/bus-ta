/**
 * 자동 탑승 판정(AUTO_DETECTED) 전용 로직.
 *
 * 예모님 확정(2026-08-24): 지팡이가 계산하는 상태(APPROACHING/ARRIVED 등)는
 * "버스 접근·정차 안내와 진동 제어"용으로만 쓰고, 탑승 확정 판정에는 재사용하지 않는다.
 * 대신 지팡이가 Notify로 함께 보내주는 원시 RSSI 값을 앱이 직접 수집해서,
 * 이 모듈에서 연속 감지·RSSI 추세·히스테리시스를 적용해 AUTO_DETECTED 여부를 판정한다.
 * 이렇게 분리해야 지팡이 진동 기준(ARRIVED 임계값 등)을 나중에 조정해도
 * 탑승 판정 로직이 같이 흔들리지 않는다.
 *
 * 정민님 확인(2026-08-24): RSSI 임계값과 연속 감지 시간은 아직 실측 데이터가 부족해
 * 확정되지 않았다. 아래 설정값은 임시값이며, 실측 데이터가 나오면 갱신해야 한다.
 *
 * 예모님 지적(2026-08-27): 기존에는 "임계값 아래로 떨어진 횟수"만 세서, 시간 연속성을
 * 보장하지 못했다 (긴 신호 공백이나 긴 RSSI 하락 뒤에도 샘플 1건만 정상이면 예전 시작
 * 시각이 그대로 남아 있어 바로 확정될 위험이 있었다). 이제 "마지막 정상 샘플 시각"과
 * "최대 허용 샘플 간격(maxSampleGapMs)"을 기준으로, 그 간격을 넘겨서 샘플이 오면
 * 연속 구간 자체를 리셋한다.
 */

// TODO(정민님 실측 대기): 아래 값들은 실측 전 임시값이다.
// 정차 판정 기준(-68 ~ -73)보다 더 엄격한(더 가까운) 값을 쓰기로 했다.
const BOARDING_DETECTION_CONFIG = {
  // 탑승으로 판정할 RSSI 기준값. 이 값 "이상"(즉 더 가까움)이어야 탑승 후보로 본다.
  rssiThreshold: -60,
  // 위 기준을 만족하는 상태가 이 시간(ms) 이상 연속 유지되어야 탑승으로 확정한다.
  requiredDurationMs: 7000,
  // 히스테리시스: 한 번 임계값을 벗어나도, 이 횟수 이내의 순간적 이탈(노이즈)은 무시한다.
  toleratedDropCount: 2,
  // 정상 샘플 사이에 이 시간(ms)보다 더 긴 공백이 생기면, 연속 구간이 끊긴 것으로 보고
  // 처음부터 다시 판정한다. 신호 공백·긴 RSSI 하락으로 인한 오탐을 방지한다.
  maxSampleGapMs: 4000,
};

/**
 * RSSI 히스토리를 기반으로 연속 감지 여부를 추적하고, 조건이 충족되면 콜백을 호출하는
 * 판정기를 생성한다. 판정기 하나가 "한 번의 운행(tripId)" 동안의 상태를 관리한다.
 *
 * @param {object} [config] - BOARDING_DETECTION_CONFIG를 덮어쓸 설정값 (테스트·튜닝용)
 * @returns {{
 *   ingest: (sample: { rssi: number, beaconId?: string, timestamp?: number }) => void,
 *   reset: () => void,
 * }}
 */
export function createBoardingDetector(config = {}) {
  const settings = { ...BOARDING_DETECTION_CONFIG, ...config };

  let aboveThresholdSinceMs = null; // 현재 연속 구간이 시작된 시각
  let lastSampleAtMs = null; // 마지막으로 처리한 샘플의 시각 (공백 판정용)
  let consecutiveDropCount = 0;
  let confirmed = false;

  let onConfirmedCallback = null;

  function reset() {
    aboveThresholdSinceMs = null;
    lastSampleAtMs = null;
    consecutiveDropCount = 0;
    confirmed = false;
  }

  function startNewWindow(now) {
    aboveThresholdSinceMs = now;
    consecutiveDropCount = 0;
  }

  /**
   * 새 RSSI 샘플을 판정기에 전달한다. subscribeCaneState 콜백에서 매번 호출한다.
   * @param {{ rssi: number, beaconId?: string, timestamp?: number }} sample
   */
  function ingest(sample) {
    if (confirmed) return; // 이미 확정됐으면 더 이상 판정하지 않는다.

    const now = sample.timestamp ?? Date.now();

    // 마지막 샘플 이후 너무 오래 공백이 있었다면, 이전 연속 구간은 무효로 보고 새로 시작한다.
    // (긴 신호 두절이나 긴 RSSI 하락 뒤 샘플 1건만 정상이어도 바로 확정되는 것을 방지)
    if (lastSampleAtMs !== null && now - lastSampleAtMs > settings.maxSampleGapMs) {
      aboveThresholdSinceMs = null;
      consecutiveDropCount = 0;
    }
    lastSampleAtMs = now;

    const isAboveThreshold = sample.rssi >= settings.rssiThreshold;

    if (isAboveThreshold) {
      consecutiveDropCount = 0;
      if (aboveThresholdSinceMs === null) {
        startNewWindow(now);
      }

      const elapsed = now - aboveThresholdSinceMs;
      if (elapsed >= settings.requiredDurationMs) {
        confirmed = true;
        onConfirmedCallback?.({ rssi: sample.rssi, beaconId: sample.beaconId, detectedAt: new Date(now).toISOString() });
      }
      return;
    }

    // 임계값 아래로 떨어진 경우: 히스테리시스 허용 범위 안이면 무시하고, 넘으면 리셋한다.
    consecutiveDropCount += 1;
    if (consecutiveDropCount > settings.toleratedDropCount) {
      aboveThresholdSinceMs = null;
      consecutiveDropCount = 0;
    }
  }

  return {
    ingest,
    reset,
    /** 판정 완료(탑승 확정) 시 호출될 콜백을 등록한다. */
    onConfirmed(callback) {
      onConfirmedCallback = callback;
    },
  };
}

export { BOARDING_DETECTION_CONFIG };