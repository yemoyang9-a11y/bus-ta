import { BELL_STATUS } from "@bus-ta/shared";
import type { TripProgressData } from "./update-trip-status.service.js";

export interface GetTripStatusRepository {
  findTripProgressData(tripId: string): Promise<TripProgressData | null>;
}

export interface GetTripStatusDependencies extends GetTripStatusRepository {
  now?: () => string;
}

type Station = TripProgressData["trip"]["stationList"][number];

type GetTripStatusSuccessBody = {
  success: true;
  tripId: string;
  destination: string;
  routeNo: string;
  currentStation: Station | null;
  nextStation: Station | null;
  remainingStations: number;
  tripStatus: string;
  bellStatus: string;
  shouldTriggerBell: false;
  bellRequestId?: string;
  command: "STOP_REQUEST" | null;
  guideMessage: string;
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
  const body: GetTripStatusSuccessBody = {
    success: true,
    tripId: progressData.trip.tripId,
    destination: progressData.trip.destination,
    routeNo: progressData.trip.routeNo,
    currentStation: status.currentStation,
    nextStation: status.nextStation,
    remainingStations: status.remainingStations,
    tripStatus: status.tripStatus,
    bellStatus: status.bellStatus,
    shouldTriggerBell: false,
    command: status.command,
    guideMessage: getGuideMessage(status.remainingStations, status.bellStatus),
    timestamp,
  };

  if (status.bellRequestId) {
    body.bellRequestId = status.bellRequestId;
  }

  return { httpStatus: 200, body };
}

function getGuideMessage(remainingStations: number, bellStatus: string) {
  if (bellStatus === BELL_STATUS.SUCCESS) {
    return "하차벨 요청이 정상 처리되었습니다.";
  }
  if (bellStatus === BELL_STATUS.FAIL) {
    return "하차벨 요청이 실패했습니다.";
  }
  if (bellStatus === BELL_STATUS.PENDING) {
    return "하차벨 요청 결과를 기다리고 있습니다.";
  }
  if (remainingStations === 0) {
    return "목적지 정류장에 도착했습니다.";
  }
  if (remainingStations === 1) {
    return "하차까지 한 정류장 남았습니다.";
  }
  if (remainingStations === 2) {
    return "하차까지 두 정류장 남았습니다. 하차 준비를 시작하세요.";
  }
  return "이동 중입니다.";
}
