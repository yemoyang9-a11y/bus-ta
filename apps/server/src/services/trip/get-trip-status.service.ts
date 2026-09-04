import { TRIP_STATUS, type ArrivalInfo } from "@bus-ta/shared";
import type { TripProgressData } from "./update-trip-status.service.js";
import { buildGuideMessage } from "./guide-message.js";
import { shouldScanBeacon } from "../arrival/arrival-poll-policy.js";

export interface GetTripStatusRepository {
  findTripProgressData(tripId: string): Promise<TripProgressData | null>;
}

export interface GetTripStatusDependencies extends GetTripStatusRepository {
  /**
   * 도착정보를 새로 조회한다. `arrivals` 가 비어 있는 이유가 "차량 없음"인지
   * 도착정보 조회 결과의 성격은 `arrivalStatus` 로 구분한다.
   */
  /** 사용자가 "버스 놓쳤어요"처럼 최신 값을 명시적으로 요구했는지. */
  refreshArrivals?: boolean;
  getArrivals?: (target: {
    gbisStationId: string;
    localBusId: string;
    destinationStation?: Station;
    /** 갱신 시점 전이라도 다시 조회할지. 캐시 구현이 최소 간격 하한은 그대로 지킨다. */
    refresh?: boolean;
  }) => Promise<{
    arrivals: ArrivalInfo[];
    arrivalStatus: "AVAILABLE" | "NO_VEHICLE" | "NO_PREDICTION" | "UPSTREAM_ERROR";
    /**
     * 다음 갱신까지 남은 시간(ms). 캐시를 거치는 구현이 알려준다.
     * 없으면 응답에서도 생략한다 — 앱이 임의 주기를 만들지 않게 한다.
     */
    nextRefreshInMs?: number;
  }>;
  now?: () => string;
}

type Station = TripProgressData["trip"]["stationList"][number];

type GetTripStatusSuccessBody = {
  success: true;
  tripId: string;
  destination: string;
  routeNo: string;
  /**
   * 탑승 정류장에 오는 차량. 정류장에서 기다리는 동안(WAITING_BUS)에만 의미가 있어
   * 그때만 조회하고 그때만 싣는다. 탑승한 뒤에는 이 값을 쓸 곳이 없는데 조회하면
   * 운행 내내 GBIS 호출만 늘어난다.
   */
  arrivals?: ArrivalInfo[];
  arrivalStatus?: "AVAILABLE" | "NO_VEHICLE" | "NO_PREDICTION" | "UPSTREAM_ERROR";
  /**
   * 앱이 다음 도착정보 조회까지 기다릴 시간(ms).
   *
   * 앱이 주기를 스스로 정하면 서버의 호출 정책과 어긋난다. 남은 시간이 짧을수록
   * 짧아지고(최소 20초), 멀면 최대 5분이다. 값이 없으면 앱은 반복 조회를 하지 않는다.
   */
  nextArrivalRefreshInMs?: number;
  /**
   * 스마트지팡이 비콘 스캔을 시작해야 하는지.
   *
   * 탑승 확정 전(WAITING_BUS)에만 의미가 있다. 한 번 켜면 끄지 않는 것은 앱 책임이다 —
   * 앞차가 떠나면 도착 예정 시간이 다시 늘어나는데, 그때 끄면 정작 버스가 눈앞에
   * 왔을 때 스캔이 꺼져 있다.
   */
  shouldScanBeacon?: boolean;
  currentStation: Station | null;
  nextStation: Station | null;
  remainingStations: number;
  tripStatus: string;
  boardingMethod: "USER_CONFIRMED" | "AUTO_DETECTED" | null;
  boardingConfirmedAt: string | null;
  bellStatus: string;
  shouldTriggerBell: false;
  bellRequestId?: string;
  command: "STOP_REQUEST" | null;
  guideMessage: string;
  message: string;
  timestamp: string;
};

type GetTripStatusErrorBody = {
  success: false;
  errorCode: "TRIP_NOT_FOUND" | "DB_ERROR";
  message: string;
  timestamp: string;
};

export type GetTripStatusResult =
  | { httpStatus: 200; body: GetTripStatusSuccessBody }
  | { httpStatus: 404; body: GetTripStatusErrorBody }
  | { httpStatus: 500; body: GetTripStatusErrorBody };

const defaultNow = () => new Date().toISOString();

/**
 * 조회 전용 API. DB 상태를 바꾸지 않고 하차벨 요청도 새로 만들지 않는다.
 * (하차벨 자동 생성은 PATCH /status 에서만 일어난다.)
 */
export async function getTripStatus(
  tripId: string,
  dependencies: GetTripStatusDependencies,
): Promise<GetTripStatusResult> {
  const now = dependencies.now ?? defaultNow;
  const timestamp = now();

  let progressData: TripProgressData | null;
  try {
    progressData = await dependencies.findTripProgressData(tripId);
  } catch {
    return {
      httpStatus: 500,
      body: {
        success: false,
        errorCode: "DB_ERROR",
        message: "운행 상태를 조회하지 못했습니다.",
        timestamp,
      },
    };
  }

  if (!progressData) {
    return {
      httpStatus: 404,
      body: {
        success: false,
        errorCode: "TRIP_NOT_FOUND",
        message: "운행 정보를 찾을 수 없습니다.",
        timestamp,
      },
    };
  }

  const status = progressData.status;
  // 도착정보는 대기 중에만 조회한다. 탑승한 뒤에도 부르면 운행 내내 GBIS 호출이
  // 이어지는데, 그 값을 쓸 곳이 없다.
  const waitingForBus = status.tripStatus === TRIP_STATUS.WAITING_BUS;
  const arrivalResult = waitingForBus
    ? await refreshArrivals(
        progressData,
        dependencies.getArrivals,
        dependencies.refreshArrivals === true,
      )
    : null;
  const body: GetTripStatusSuccessBody = {
    success: true,
    tripId: progressData.trip.tripId,
    destination: progressData.trip.destination,
    routeNo: progressData.trip.routeNo,
    currentStation: status.currentStation,
    nextStation: status.nextStation,
    remainingStations: status.remainingStations,
    tripStatus: status.tripStatus,
    boardingMethod: status.boardingMethod,
    boardingConfirmedAt: status.boardingConfirmedAt,
    bellStatus: status.bellStatus,
    shouldTriggerBell: false,
    // 조회 전용 — 하차벨 명령은 PATCH 자동 생성 응답에서만 전달한다(계약). 항상 null.
    command: null,
    guideMessage:
      status.tripStatus === TRIP_STATUS.CANCELLED
        ? "운행 안내가 종료되었습니다."
        : status.tripStatus === TRIP_STATUS.WAITING_BUS
          ? "버스 탑승을 기다리고 있습니다."
        : buildGuideMessage(status.remainingStations, status.bellStatus),
    message: "현재 이동 상태를 조회했습니다.",
    timestamp,
  };

  if (status.bellRequestId) {
    body.bellRequestId = status.bellRequestId;
  }

  // 도착정보 관련 네 필드는 대기 중에만 싣는다. 탑승한 뒤에는 쓸 곳이 없는데,
  // 하나만 남겨 두면 "왜 이건 오고 저건 안 오지"로 계약이 헷갈린다.
  if (arrivalResult !== null) {
    body.arrivals = arrivalResult.arrivals;
    body.arrivalStatus = arrivalResult.arrivalStatus;
    // 탑승 확정 전에만 스캔 신호를 준다. 탑승한 뒤에는 비콘을 더 찾을 이유가 없다.
    body.shouldScanBeacon = shouldStartBeaconScan(
      arrivalResult.arrivalStatus,
      arrivalResult.arrivals,
    );
    if (arrivalResult.nextRefreshInMs !== undefined) {
      body.nextArrivalRefreshInMs = arrivalResult.nextRefreshInMs;
    }
  }

  return { httpStatus: 200, body };
}

/**
 * 비콘 스캔을 시작할지.
 *
 * 조회 자체를 못 한 경우(UPSTREAM_ERROR)와 조회는 됐지만 예상 시간이 없는 경우는
 * 켠다. 값이 없다고 막으면 비콘 감지가 영영 시작되지 않아 자동 탑승 판정이 동작하지
 * 않는다. 배터리보다 탑승을 놓치지 않는 쪽을 우선한다.
 *
 * UPSTREAM_ERROR 는 arrivals 가 비어 있지 않을 수 있다. arrival-cache 가 조회에
 * 실패해도 직전 성공 값을 함께 돌려주기 때문이다. 그 값은 지금 남은 시간의 근거가
 * 되지 못하므로 스캔 판단에 쓰지 않는다. 예를 들어 캐시에 10분이 남아 있으면
 * "아직 멀었다"로 읽혀 스캔이 꺼지는데, 실제로는 버스가 눈앞에 와 있어도 지팡이가
 * 진동하지 않는다. 조회에 실패했다는 사실이 캐시된 숫자보다 우선한다.
 *
 * 다만 NO_VEHICLE 은 "조회에 성공했고 지금 오는 차가 없다"는 확인된 사실이다.
 * 이때까지 켜 두면 올 차도 없는데 배터리만 쓴다.
 */
function shouldStartBeaconScan(
  arrivalStatus: NonNullable<GetTripStatusSuccessBody["arrivalStatus"]>,
  arrivals: ArrivalInfo[],
): boolean {
  if (arrivalStatus === "NO_VEHICLE") return false;
  if (arrivalStatus === "UPSTREAM_ERROR") return true;
  return shouldScanBeacon(arrivals[0]?.predictedArrivalMinutes ?? null);
}

async function refreshArrivals(
  progressData: TripProgressData,
  getArrivals: GetTripStatusDependencies["getArrivals"],
  refresh: boolean,
): Promise<{
  arrivals: ArrivalInfo[];
  arrivalStatus: NonNullable<GetTripStatusSuccessBody["arrivalStatus"]>;
  nextRefreshInMs?: number;
}> {
  const { gbisStationId, localBusId } = progressData.trip;
  if (!getArrivals || !gbisStationId || !localBusId) {
    return { arrivals: [], arrivalStatus: "UPSTREAM_ERROR" };
  }

  try {
    const destinationStation =
      progressData.trip.destinationStation ??
      progressData.trip.stationList[progressData.trip.stationList.length - 1];
    const lookup = await getArrivals({
      gbisStationId,
      localBusId,
      ...(destinationStation ? { destinationStation } : {}),
      ...(refresh ? { refresh: true } : {}),
    });
    return {
      arrivals: lookup.arrivals,
      arrivalStatus: lookup.arrivalStatus,
      ...(lookup.nextRefreshInMs !== undefined
        ? { nextRefreshInMs: lookup.nextRefreshInMs }
        : {}),
    };
  } catch {
    // 재조회 실패는 운행 상태 오류가 아니다. 이전 도착시간을 재사용하지 않고
    // 빈 배열과 별도 상태로 반환해 Dispatcher가 추측 안내를 하지 않게 한다.
    return { arrivals: [], arrivalStatus: "UPSTREAM_ERROR" };
  }
}
