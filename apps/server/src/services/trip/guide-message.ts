import { BELL_STATUS } from "@bus-ta/shared";

/**
 * 이동 상태 + 하차벨 상태에 따른 안내 문구 단일 출처.
 * PATCH /status 와 GET /status 가 같은 규칙을 사용하도록 한 곳에서 관리한다.
 *
 * @param shouldTriggerBell 이번 요청에서 하차벨을 막 자동 생성한 경우 true (PATCH 전용)
 */
export function buildGuideMessage(
  remainingStations: number,
  bellStatus: string,
  shouldTriggerBell = false,
): string {
  if (remainingStations === 0) {
    return "목적지 정류장에 도착했습니다.";
  }
  if (shouldTriggerBell) {
    return "하차벨을 요청했습니다. 하차를 준비하세요.";
  }
  if (bellStatus === BELL_STATUS.SUCCESS) {
    return "하차벨 요청이 정상 처리되었습니다.";
  }
  if (bellStatus === BELL_STATUS.FAIL) {
    return "하차벨 요청이 실패했습니다.";
  }
  if (bellStatus === BELL_STATUS.PENDING) {
    return "하차벨 요청 결과를 기다리고 있습니다.";
  }
  if (remainingStations === 1) {
    return "하차까지 한 정류장 남았습니다. 하차벨 요청을 준비합니다.";
  }
  if (remainingStations === 2) {
    return "하차까지 두 정류장 남았습니다. 하차 준비를 시작하세요.";
  }
  return "이동 중입니다.";
}
