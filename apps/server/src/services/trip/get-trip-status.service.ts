import type { TripProgressData } from "./update-trip-status.service.js";
import { buildGuideMessage } from "./guide-message.js";

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
    // 조회 전용 — 하차벨 명령은 PATCH 자동 생성 응답에서만 전달한다(계약). 항상 null.
    command: null,
    guideMessage: buildGuideMessage(status.remainingStations, status.bellStatus),
    message: "현재 이동 상태를 조회했습니다.",
    timestamp,
  };

  if (status.bellRequestId) {
    body.bellRequestId = status.bellRequestId;
  }

  return { httpStatus: 200, body };
}
