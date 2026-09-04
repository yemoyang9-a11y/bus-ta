/**
 * 서버가 "스캔을 켜라"고 한 시점에 실제로 켜도 되는지 판단한다.
 *
 * 예모님 지적(2026-09-04, PR #47 P1): 서버 신호가 지팡이 준비보다 먼저 도착할 수
 * 있다. 그때 startBeaconScan() 은 BLE_NOT_CONNECTED 로 실패하는데, 실패해도
 * beaconScanActive 는 false 그대로이고 shouldScanBeacon 도 계속 true 라서 화면의
 * effect 의존값이 바뀌지 않는다. 그러면 다시 시도되지 않고 스캔이 영영 안 켜진다.
 *
 * 그래서 "지팡이 준비 완료"를 조건과 의존값에 함께 넣는다. 신호가 먼저 와도
 * 준비가 끝나는 순간 값이 바뀌면서 그때 시작된다.
 *
 * 판단만 하고 부수효과는 없다. 화면에서 떼어내야 테스트할 수 있어서 분리했다.
 *
 * @param {object} input
 * @param {boolean} input.shouldScanBeacon 서버가 내려준 스캔 시작 신호
 * @param {boolean} input.caneReady 지팡이 연결과 대상 비콘 지정이 끝났는지
 * @param {boolean} input.beaconScanActive 이미 스캔이 돌고 있는지
 * @param {boolean} input.starting 지금 시작 요청이 진행 중인지
 * @returns {boolean}
 */
export function canStartBeaconScan({
  shouldScanBeacon,
  caneReady,
  beaconScanActive,
  starting,
}) {
  if (!shouldScanBeacon) return false;
  // 지팡이가 대상 비콘을 모르는 상태에서 스캔 명령을 보내면 실패한다.
  if (!caneReady) return false;
  if (beaconScanActive) return false;
  if (starting) return false;
  return true;
}
