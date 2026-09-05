import type { ArrivalInfo, ArrivalStatus } from "@bus-ta/shared";
import type {
  RealtimeGuideContext,
  TripStatusChangedEvent,
  TripStatusSnapshot,
} from "./types";

/**
 * 이벤트 Dispatcher — 상태 변화를 감지해 Realtime 세션에 주입할 이벤트를 만든다.
 *
 * 3초마다 GPS를 보내고 응답을 받지만, 매번 세션에 알리면 비효율적이므로
 * "진짜로 바뀐 값"이 있을 때만 이벤트를 생성한다.
 *
 * 감지 대상 (프론트엔드 지침서 기준):
 * - tripStatus
 * - boardingMethod
 * - boardingConfirmedAt
 * - remainingStations
 * - currentStation.stationName
 * - bellStatus
 * - 첫 차량의 도착 임박 진입 (아래 isNewlyImminent 참고)
 */

/**
 * 자동 임박 안내를 시작하는 경계(분).
 *
 * 도착 예정 시간이 갱신될 때마다 말하면 기다리는 내내 계속 떠든다. 그렇다고
 * 아무 말도 하지 않으면 눈으로 버스를 볼 수 없는 사용자가 탑승 순간을 놓친다.
 * 그래서 "처음 이 값 이내로 들어온 순간" 한 번만 안내한다.
 */
const IMMINENT_ARRIVAL_MINUTES = 2;

function readFirstArrivalMinutes(status: TripStatusSnapshot): number | null {
  // 안내 판단은 배열이 비었는지가 아니라 arrivalStatus 로 한다. 조회 실패도
  // 빈 배열로 오기 때문에, 배열만 보면 실패가 "차 없음"으로 둔갑한다.
  if (status.arrivalStatus !== "AVAILABLE") return null;
  const first = status.arrivals?.[0]?.predictedArrivalMinutes;
  return typeof first === "number" && Number.isFinite(first) ? first : null;
}

function isImminent(minutes: number | null): boolean {
  return minutes !== null && minutes <= IMMINENT_ARRIVAL_MINUTES;
}

/**
 * 이번 갱신에서 처음으로 임박 구간에 들어왔는지.
 *
 * 3분 → 2분은 안내하고, 2분 → 1분은 같은 구간 안이므로 다시 안내하지 않는다.
 */
function isNewlyImminent(
  prevStatus: TripStatusSnapshot | null,
  nextStatus: TripStatusSnapshot,
): boolean {
  if (!isImminent(readFirstArrivalMinutes(nextStatus))) return false;
  return !isImminent(prevStatus ? readFirstArrivalMinutes(prevStatus) : null);
}

/**
 * 이번 응답의 도착정보를 확정한다.
 *
 * 3초 주기 PATCH /status 응답에는 도착정보가 아예 없다(`undefined`). 그걸 그대로
 * 받아 "값 없음"으로 저장하면 직전 GET 이 확인한 2분을 잊어버려, 다음 GET 의 1분이
 * 다시 "처음 임박 진입"으로 보이고 같은 안내가 두 번 나간다.
 *
 * 반대로 탑승이 확정돼 대기 상태를 벗어나면 승차 정류장의 도착정보는 의미가 없으므로
 * 명시적으로 비운다. (state/trip-reducer.js 의 resolveArrivalFields 와 같은 규칙)
 */
function resolveArrivalFields(
  prevStatus: TripStatusSnapshot | null,
  nextStatus: TripStatusSnapshot,
): { arrivalStatus: ArrivalStatus | null; arrivals: ArrivalInfo[] | null } {
  if (nextStatus.arrivalStatus !== undefined || nextStatus.arrivals !== undefined) {
    return {
      arrivalStatus: nextStatus.arrivalStatus ?? null,
      arrivals: nextStatus.arrivals ?? null,
    };
  }

  if (nextStatus.tripStatus !== "WAITING_BUS") {
    return { arrivalStatus: null, arrivals: null };
  }

  return {
    arrivalStatus: prevStatus?.arrivalStatus ?? null,
    arrivals: prevStatus?.arrivals ?? null,
  };
}

function hasRelevantChange(
  prevStatus: TripStatusSnapshot | null,
  nextStatus: TripStatusSnapshot,
): boolean {
  if (!prevStatus) return true; // 이전 상태가 없으면(최초 1회) 무조건 변화로 취급

  if (prevStatus.tripStatus !== nextStatus.tripStatus) return true;
  if (prevStatus.boardingMethod !== nextStatus.boardingMethod) return true;
  if (prevStatus.boardingConfirmedAt !== nextStatus.boardingConfirmedAt) return true;
  if (prevStatus.remainingStations !== nextStatus.remainingStations) return true;
  if (prevStatus.bellStatus !== nextStatus.bellStatus) return true;

  const prevStationName = prevStatus.currentStation?.stationName ?? null;
  const nextStationName = nextStatus.currentStation?.stationName ?? null;
  if (prevStationName !== nextStationName) return true;

  // 도착시간이 5분 → 3분으로 줄었다는 이유만으로는 안내하지 않는다. 임박 구간에
  // 처음 들어온 경계에서만 말한다.
  if (isNewlyImminent(prevStatus, nextStatus)) return true;

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
    boardingMethod: nextStatus.boardingMethod,
    boardingConfirmedAt: nextStatus.boardingConfirmedAt,
    remainingStations: nextStatus.remainingStations,
    currentStationName: nextStatus.currentStation?.stationName ?? null,
    bellStatus: nextStatus.bellStatus,
    guideMessage: nextStatus.guideMessage ?? null,
    arrivalStatus: nextStatus.arrivalStatus ?? null,
    predictedArrivalMinutes: (nextStatus.arrivals ?? []).map(
      (arrival) => arrival.predictedArrivalMinutes,
    ),
  };
}

/**
 * 어떤 값이 실제로 세션에 들어갔는지 남긴다.
 *
 * 서버는 3분을 보냈는데 AI 가 5분이라고 말하면, 끊긴 지점이 앱→세션 전달인지
 * 모델 지시인지 이 로그 하나로 갈린다. 좌표·API 키·외부 URL 은 남기지 않는다.
 */
function logStatusInjection(tripId: string | null, event: TripStatusChangedEvent): void {
  console.log(
    "[realtime/arrival] status injection",
    `injectedAt=${new Date().toISOString()}`,
    `tripId=${tripId ?? "none"}`,
    `arrivalStatus=${event.arrivalStatus ?? "none"}`,
    `predictedArrivalMinutes=[${event.predictedArrivalMinutes.join(",")}]`,
  );
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
  // 도착정보가 없는 PATCH 응답이 직전 GET 의 최신 값을 지우지 않도록 먼저 확정한다.
  const resolvedStatus: TripStatusSnapshot = {
    ...nextStatus,
    ...resolveArrivalFields(prevStatus, nextStatus),
  };

  const event = buildStatusChangeEvent(prevStatus, resolvedStatus);
  if (!event) return;

  logStatusInjection(context.getAppState().tripId, event);
  sendSystemEvent(event);
  context.dispatchAppAction({ type: "SET_LAST_INJECTED_STATUS", status: resolvedStatus });
}
