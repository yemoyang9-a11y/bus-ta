import { TRIP_STATUS, type ArrivalInfo } from "@bus-ta/shared";
import type { TripProgressData } from "./update-trip-status.service.js";
import { buildGuideMessage } from "./guide-message.js";

export interface GetTripStatusRepository {
  findTripProgressData(tripId: string): Promise<TripProgressData | null>;
}

export interface GetTripStatusDependencies extends GetTripStatusRepository {
  /**
   * 도착정보를 새로 조회한다. `arrivals` 가 비어 있는 이유가 "차량 없음"인지
   * "방향을 확인하지 못함"인지는 `lookupStatus` 로만 구분할 수 있다.
   */
  getArrivals?: (target: {
    gbisStationId: string;
    localBusId: string;
    destinationStation?: Station;
  }) => Promise<{
    arrivals: ArrivalInfo[];
    lookupStatus: "AVAILABLE" | "NO_VEHICLE" | "UNVERIFIED";
  }>;
  now?: () => string;
}

type Station = TripProgressData["trip"]["stationList"][number];

type GetTripStatusSuccessBody = {
  success: true;
  tripId: string;
  destination: string;
  routeNo: string;
  arrivals: ArrivalInfo[];
  arrivalStatus: "AVAILABLE" | "NO_VEHICLE" | "UPSTREAM_ERROR";
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
  const arrivalResult = await refreshArrivals(progressData, dependencies.getArrivals);
  const body: GetTripStatusSuccessBody = {
    success: true,
    tripId: progressData.trip.tripId,
    destination: progressData.trip.destination,
    routeNo: progressData.trip.routeNo,
    arrivals: arrivalResult.arrivals,
    arrivalStatus: arrivalResult.arrivalStatus,
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

  return { httpStatus: 200, body };
}

async function refreshArrivals(
  progressData: TripProgressData,
  getArrivals: GetTripStatusDependencies["getArrivals"],
): Promise<{
  arrivals: ArrivalInfo[];
  arrivalStatus: GetTripStatusSuccessBody["arrivalStatus"];
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
    });
    return {
      arrivals: lookup.arrivals,
      // 방향을 확인하지 못해 접은 결과를 NO_VEHICLE 로 내보내면 "이 노선은 이제
      // 안 온다"로 안내된다. 확인하지 못한 것과 차가 없는 것은 다르게 다룬다.
      arrivalStatus: lookup.lookupStatus === "UNVERIFIED" ? "UPSTREAM_ERROR" : lookup.lookupStatus,
    };
  } catch {
    // 재조회 실패는 운행 상태 오류가 아니다. 이전 도착시간을 재사용하지 않고
    // 빈 배열과 별도 상태로 반환해 Dispatcher가 추측 안내를 하지 않게 한다.
    return { arrivals: [], arrivalStatus: "UPSTREAM_ERROR" };
  }
}
