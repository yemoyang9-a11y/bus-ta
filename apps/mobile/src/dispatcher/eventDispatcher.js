/**
 * 이벤트 Dispatcher — 상태 변화를 감지해 Realtime 세션에 주입할 이벤트를 만든다.
 *
 * 3초마다 GPS를 보내고 응답을 받지만, 매번 세션에 알리면 비효율적이므로
 * "진짜로 바뀐 값"이 있을 때만 이벤트를 생성한다.
 *
 * 감지 대상 (프론트엔드 지침서 기준):
 * - tripStatus
 * - remainingStations
 * - currentStation.stationName
 * - bellStatus
 */

// 두 상태를 비교해서 감지 대상 필드 중 하나라도 바뀌었는지 확인한다.
function hasRelevantChange(prevStatus, nextStatus) {
  if (!prevStatus) return true; // 이전 상태가 없으면(최초 1회) 무조건 변화로 취급

  if (prevStatus.tripStatus !== nextStatus.tripStatus) return true;
  if (prevStatus.remainingStations !== nextStatus.remainingStations) return true;
  if (prevStatus.bellStatus !== nextStatus.bellStatus) return true;

  const prevStationName = prevStatus.currentStation?.stationName ?? null;
  const nextStationName = nextStatus.currentStation?.stationName ?? null;
  if (prevStationName !== nextStationName) return true;

  return false;
}

/**
 * 이전 상태와 새 상태를 비교해, 변화가 있으면 세션에 주입할 이벤트 객체를 반환한다.
 * 변화가 없으면 null을 반환한다 — 호출부는 null이면 세션에 아무것도 보내지 않는다.
 *
 * @param {object|null} prevStatus - 마지막으로 세션에 주입했던 상태 (TripContext의 lastInjectedStatus)
 * @param {object} nextStatus - 방금 서버에서 받은 새 상태 (PATCH /status 응답)
 * @returns {object|null} 세션에 주입할 시스템 이벤트, 또는 변화 없으면 null
 */
export function buildStatusChangeEvent(prevStatus, nextStatus) {
  if (!hasRelevantChange(prevStatus, nextStatus)) {
    return null;
  }

  return {
    type: 'trip_status_changed',
    tripStatus: nextStatus.tripStatus,
    remainingStations: nextStatus.remainingStations,
    currentStationName: nextStatus.currentStation?.stationName ?? null,
    bellStatus: nextStatus.bellStatus,
    guideMessage: nextStatus.guideMessage ?? null,
  };
}