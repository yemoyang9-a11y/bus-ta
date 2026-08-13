import type { RealtimeGuideContext, TripStatusChangedEvent, TripStatusSnapshot } from "./types";

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
function hasRelevantChange(
  prevStatus: TripStatusSnapshot | null,
  nextStatus: TripStatusSnapshot,
): boolean {
  if (!prevStatus) return true; // 이전 상태가 없으면(최초 1회) 무조건 변화로 취급

  if (prevStatus.tripStatus !== nextStatus.tripStatus) return true;
  if (prevStatus.remainingStations !== nextStatus.remainingStations) return true;
  if (prevStatus.bellStatus !== nextStatus.bellStatus) return true;

  const prevStationName = prevStatus.currentStation?.stationName ?? null;
  const nextStationName = nextStatus.currentStation?.stationName ?? null;
  if (prevStationName !== nextStationName) return true;

  return false;
}

function buildStatusChangeEvent(
  prevStatus: TripStatusSnapshot | null,
  nextStatus: TripStatusSnapshot,
): TripStatusChangedEvent | null {
  if (!hasRelevantChange(prevStatus, nextStatus)) {
    return null;
  }

  return {
    type: "trip_status_changed",
    tripStatus: nextStatus.tripStatus,
    remainingStations: nextStatus.remainingStations,
    currentStationName: nextStatus.currentStation?.stationName ?? null,
    bellStatus: nextStatus.bellStatus,
    guideMessage: nextStatus.guideMessage ?? null,
  };
}

/**
 * 방금 받은 최신 상태(nextStatus)를 이전에 세션에 보낸 상태와 비교해서,
 * 변화가 있으면 세션에 시스템 이벤트를 주입하고 lastInjectedStatus를 갱신한다.
 *
 * (2026-08-13, 예모님 코멘트 2번 반영) TripContext를 다시 읽지 않고,
 * 호출부(RidingScreen)가 방금 서버에서 받은 데이터를 직접 넘겨받아 사용한다.
 * React state의 dispatch는 비동기라, dispatch 직후 context.getAppState()를
 * 호출하면 아직 갱신되지 않은 오래된 상태를 읽을 위험이 있기 때문이다.
 *
 * @param context - RealtimeGuideContext (lastInjectedStatus 조회·갱신에 사용)
 * @param nextStatus - 방금 서버에서 받은 최신 상태
 * @param sendSystemEvent - 세션에 이벤트를 실제로 전송하는 함수 (session.ts가 제공)
 */
export function checkAndDispatchStatusChange(
  context: RealtimeGuideContext,
  nextStatus: TripStatusSnapshot,
  sendSystemEvent: (event: TripStatusChangedEvent) => void,
) {
  const prevStatus = context.getAppState().lastInjectedStatus;

  const event = buildStatusChangeEvent(prevStatus, nextStatus);
  if (!event) return;

  sendSystemEvent(event);
  context.dispatchAppAction({ type: "SET_LAST_INJECTED_STATUS", status: nextStatus });
}