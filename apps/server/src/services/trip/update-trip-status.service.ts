import { randomUUID } from "node:crypto";
import {
  BELL_COMMAND,
  BELL_STATUS,
  TRIP_STATUS,
  UpdateTripStatusRequestSchema,
  type CreateTripRequest,
  type UpdateTripStatusRequest,
} from "@bus-ta/shared";
import { buildGuideMessage } from "./guide-message.js";

type Station = CreateTripRequest["stationList"][number];

export interface TripProgressData {
  trip: {
    tripId: string;
    destination: string;
    routeNo: string;
    stationList: Station[];
    /** 도착정보 재조회에 필요한 선택 노선 식별자. 기존 소비자는 생략할 수 있다. */
    localBusId?: string;
    gbisStationId?: string;
    destinationStation?: Station;
  };
  status: {
    tripId: string;
    currentStation: Station | null;
    nextStation: Station | null;
    remainingStations: number;
    tripStatus: string;
    boardingMethod: "USER_CONFIRMED" | "AUTO_DETECTED" | null;
    boardingConfirmedAt: string | null;
    bellStatus: string;
    bellRequestId: string | null;
    command: "STOP_REQUEST" | null;
    lastRequestId: string | null;
    locationSource: string | null;
    recordedAt: string | null;
    lastLatitude: number | null;
    lastLongitude: number | null;
    locationChangedAt: string | null;
    updatedAt: string;
  };
}

export interface LocationLogLookup {
  tripId: string;
  requestId: string;
}

export interface TripStatusUpdateRecord {
  tripId: string;
  currentStation: Station | null;
  nextStation: Station | null;
  remainingStations: number;
  tripStatus: string;
  bellStatus: string;
  lastRequestId: string;
  locationSource: UpdateTripStatusRequest["source"];
  recordedAt: string;
  lastLatitude: number;
  lastLongitude: number;
  locationChangedAt: string;
  updatedAt: string;
}

export interface LocationLogCreateRecord {
  tripId: string;
  requestId: string;
  latitude: number;
  longitude: number;
  source: UpdateTripStatusRequest["source"];
  recordedAt: string;
  currentStation: Station | null;
  remainingStations: number;
  locationAccepted: boolean;
  reason:
    | "BACKWARD_STATION_IGNORED"
    | "FORWARD_JUMP_CLAMPED"
    | "FORWARD_GAP_RECOVERED"
    | null;
}

export interface BellRequestCreateRecord {
  tripId: string;
  bellRequestId: string;
  command: typeof BELL_COMMAND.STOP_REQUEST;
  requestedAt: string;
}

export interface SaveStatusAndLocationInput {
  status: TripStatusUpdateRecord;
  locationLog: LocationLogCreateRecord;
  /**
   * remainingStations=1 & bellStatus=NOT_REQUESTED 감지 시에만 채워진다.
   * 채워지면 repository 가 bell_logs 에 STOP_REQUEST 요청을 기록한다.
   */
  bellRequest?: BellRequestCreateRecord | null;
}

export interface SaveStatusAndLocationResult {
  bellCreated: boolean;
  retryAfterBoardingConfirmation?: boolean;
}

export interface UpdateTripStatusRepository {
  findTripProgressData(tripId: string): Promise<TripProgressData | null>;
  findLocationLogByRequestId(tripId: string, requestId: string): Promise<LocationLogLookup | null>;
  saveStatusAndLocation(
    data: SaveStatusAndLocationInput,
  ): Promise<SaveStatusAndLocationResult | void>;
}

export interface UpdateTripStatusDependencies extends UpdateTripStatusRepository {
  now?: () => string;
  generateBellRequestId?: () => string;
}

/**
 * 위치 상태를 읽은 뒤 사용자가 운행을 종료한 경우 repository가 반환한다.
 * 이 경우 GPS 로그와 상태 변경은 하나의 DB 트랜잭션으로 모두 롤백된다.
 */
export class TripCancelledDuringUpdateError extends Error {
  constructor() {
    super("Trip was cancelled while the location update was being saved");
    this.name = "TripCancelledDuringUpdateError";
  }
}

export class TripCompletedDuringUpdateError extends Error {
  constructor() {
    super("Trip was completed while the location update was being saved");
    this.name = "TripCompletedDuringUpdateError";
  }
}

/**
 * 같은 (tripId, requestId)로 두 요청이 거의 동시에 들어와, 둘 다 애플리케이션 레벨의
 * 중복 검사(findLocationLogByRequestId)를 통과한 뒤 한쪽만 저장에 성공한 경우 repository가 반환한다.
 * DB의 UNIQUE 제약이 최종 방어선이며, 이 경우 500이 아니라 기존 중복 요청과 동일하게 200을 반환한다.
 */
export class DuplicateLocationRequestError extends Error {
  constructor() {
    super("A concurrent request already saved this location update");
    this.name = "DuplicateLocationRequestError";
  }
}

type UpdateTripStatusSuccessBody = {
  success: true;
  tripId: string;
  destination: string;
  routeNo: string;
  currentStation: Station | null;
  nextStation: Station | null;
  remainingStations: number;
  tripStatus: string;
  boardingMethod: "USER_CONFIRMED" | "AUTO_DETECTED" | null;
  boardingConfirmedAt: string | null;
  bellStatus: string;
  shouldTriggerBell: boolean;
  bellRequestId?: string;
  command: typeof BELL_COMMAND.STOP_REQUEST | null;
  guideMessage: string;
  locationStatus?: "STALE";
  locationGapSeconds?: number;
  locationWarning?: string;
  source?: UpdateTripStatusRequest["source"];
  message: string;
  timestamp: string;
};

type UpdateTripStatusErrorBody = {
  success: false;
  errorCode:
    | "INVALID_REQUEST"
    | "TRIP_NOT_FOUND"
    | "INVALID_TRIP_STATUS"
    | "BOARDING_STATE_INCONSISTENT"
    | "DB_ERROR";
  message: string;
  timestamp: string;
};

export type UpdateTripStatusResult =
  | { httpStatus: 200; body: UpdateTripStatusSuccessBody }
  | { httpStatus: 400; body: UpdateTripStatusErrorBody }
  | { httpStatus: 404; body: UpdateTripStatusErrorBody }
  | { httpStatus: 409; body: UpdateTripStatusErrorBody }
  | { httpStatus: 500; body: UpdateTripStatusErrorBody };

const defaultNow = () => new Date().toISOString();
const defaultGenerateBellRequestId = () => `bell-${randomUUID()}`;
const STALE_LOCATION_GAP_MS = 60_000;

export async function updateTripStatus(
  tripId: string,
  input: unknown,
  dependencies: UpdateTripStatusDependencies,
  canRetryAfterBoardingConfirmation = true,
): Promise<UpdateTripStatusResult> {
  const now = dependencies.now ?? defaultNow;
  const timestamp = now();
  const parsed = UpdateTripStatusRequestSchema.safeParse(input);

  if (!parsed.success) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        errorCode: "INVALID_REQUEST",
        message: "요청 데이터가 올바르지 않습니다.",
        timestamp,
      },
    };
  }

  let progressData: TripProgressData | null;
  try {
    progressData = await dependencies.findTripProgressData(tripId);
  } catch {
    return {
      httpStatus: 500,
      body: {
        success: false,
        errorCode: "DB_ERROR",
        message: "운행 정보를 조회하지 못했습니다.",
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

  if (hasInconsistentBoardingState(progressData)) {
    return {
      httpStatus: 409,
      body: {
        success: false,
        errorCode: "BOARDING_STATE_INCONSISTENT",
        message: "운행 상태와 탑승 근거가 일치하지 않습니다.",
        timestamp,
      },
    };
  }

  // 멱등성 우선: 이미 처리된 requestId는 그 사이 트립이 CANCELLED/TRIP_DONE으로
  // 바뀌었더라도 항상 캐시된 성공 응답을 그대로 반환한다. 상태 종료 체크는
  // "새 요청"에만 적용된다 (아래 CANCELLED 체크, 그리고 TRIP_DONE은 DB 함수에서 처리).
  let duplicate: LocationLogLookup | null;
  try {
    duplicate = await dependencies.findLocationLogByRequestId(tripId, parsed.data.requestId);
  } catch {
    return {
      httpStatus: 500,
      body: {
        success: false,
        errorCode: "DB_ERROR",
        message: "중복 요청 확인에 실패했습니다.",
        timestamp,
      },
    };
  }

  if (duplicate) {
    return {
      httpStatus: 200,
      body: toResponseBody(progressData, {
        message: "이미 처리된 위치 업데이트입니다.",
        timestamp,
      }),
    };
  }

  if (progressData.status.tripStatus === TRIP_STATUS.CANCELLED) {
    return {
      httpStatus: 409,
      body: {
        success: false,
        errorCode: "INVALID_TRIP_STATUS",
        message: "종료된 운행의 위치는 갱신할 수 없습니다.",
        timestamp,
      },
    };
  }

  const boardingConfirmed = hasConfirmedBoarding(progressData);
  const locationStale = isLocationStale(progressData.status, parsed.data);
  const calculatedProgress = calculateProgress(progressData, parsed.data, locationStale.isStale);
  const progress = {
    ...calculatedProgress,
    tripStatus: boardingConfirmed
      ? calculatedProgress.tripStatus
      : TRIP_STATUS.WAITING_BUS,
  };

  // 5단계: 하차 1정거장 전 하차벨 자동 요청 생성.
  // remainingStations=1 & bellStatus=NOT_REQUESTED 일 때만 STOP_REQUEST 를 생성하고 PENDING 으로 전환한다.
  // PENDING/SUCCESS/FAIL 이면 중복 생성하지 않는다.
  const shouldTriggerBell =
    boardingConfirmed &&
    progress.remainingStations === 1 &&
    progressData.status.bellStatus === BELL_STATUS.NOT_REQUESTED;

  let bellStatus = progressData.status.bellStatus;
  let bellRequestId = progressData.status.bellRequestId;
  let command = progressData.status.command;
  let bellRequest: BellRequestCreateRecord | null = null;

  if (shouldTriggerBell) {
    const generateBellRequestId =
      dependencies.generateBellRequestId ?? defaultGenerateBellRequestId;
    bellRequestId = generateBellRequestId();
    command = BELL_COMMAND.STOP_REQUEST;
    bellStatus = BELL_STATUS.PENDING;
    bellRequest = {
      tripId,
      bellRequestId,
      command: BELL_COMMAND.STOP_REQUEST,
      requestedAt: timestamp,
    };
  }

  const status: TripStatusUpdateRecord = {
    tripId,
    currentStation: progress.currentStation,
    nextStation: progress.nextStation,
    remainingStations: progress.remainingStations,
    tripStatus: progress.tripStatus,
    bellStatus,
    lastRequestId: parsed.data.requestId,
    locationSource: parsed.data.source,
    recordedAt: parsed.data.recordedAt,
    lastLatitude: parsed.data.latitude,
    lastLongitude: parsed.data.longitude,
    locationChangedAt: locationStale.sameAsLast
      ? progressData.status.locationChangedAt ?? parsed.data.recordedAt
      : parsed.data.recordedAt,
    updatedAt: timestamp,
  };

  let saveResult: SaveStatusAndLocationResult | void;
  try {
    saveResult = await dependencies.saveStatusAndLocation({
      status,
      locationLog: {
        tripId,
        requestId: parsed.data.requestId,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        source: parsed.data.source,
        recordedAt: parsed.data.recordedAt,
        currentStation: progress.currentStation,
        remainingStations: progress.remainingStations,
        locationAccepted: progress.locationAccepted,
        reason: progress.reason,
      },
      ...(bellRequest ? { bellRequest } : {}),
    });
  } catch (error) {
    if (
      error instanceof TripCancelledDuringUpdateError ||
      error instanceof TripCompletedDuringUpdateError
    ) {
      return {
        httpStatus: 409,
        body: {
          success: false,
          errorCode: "INVALID_TRIP_STATUS",
          message: "종료된 운행의 위치는 갱신할 수 없습니다.",
          timestamp,
        },
      };
    }

    if (error instanceof DuplicateLocationRequestError) {
      // 동시 요청 레이스: 다른 요청이 같은 requestId로 이미 저장을 마쳤다.
      // 500 DB_ERROR로 새지 않도록, 최신 상태를 다시 읽어 기존 중복 요청 경로와
      // 동일하게 200으로 응답한다. 재조회에 실패하면 이번 요청 시작 시점의
      // 스냅숏(progressData)으로라도 응답한다.
      let latest: TripProgressData | null;
      try {
        latest = await dependencies.findTripProgressData(tripId);
      } catch {
        latest = null;
      }

      return {
        httpStatus: 200,
        body: toResponseBody(latest ?? progressData, {
          message: "이미 처리된 위치 업데이트입니다.",
          timestamp,
        }),
      };
    }

    return {
      httpStatus: 500,
      body: {
        success: false,
        errorCode: "DB_ERROR",
        message: "이동 상태를 저장하지 못했습니다.",
        timestamp,
      },
    };
  }

  if (saveResult?.retryAfterBoardingConfirmation) {
    if (!canRetryAfterBoardingConfirmation) {
      return {
        httpStatus: 500,
        body: {
          success: false,
          errorCode: "DB_ERROR",
          message: "탑승확정 이후 위치를 재계산하지 못했습니다.",
          timestamp,
        },
      };
    }

    return updateTripStatus(tripId, input, dependencies, false);
  }

  // Supabase returns whether this transaction won the bell compare-and-set.
  // Re-read after that atomic write so a confirmation that committed while a
  // stale GPS request was in flight cannot be hidden by the optimistic local
  // snapshot. Repositories that return void retain the local/test fallback.
  if (saveResult) {
    let authoritativeProgress: TripProgressData | null;
    try {
      authoritativeProgress = await dependencies.findTripProgressData(tripId);
    } catch {
      authoritativeProgress = null;
    }

    if (!authoritativeProgress) {
      return {
        httpStatus: 500,
        body: {
          success: false,
          errorCode: "DB_ERROR",
          message: "저장된 이동 상태를 확인하지 못했습니다.",
          timestamp,
        },
      };
    }

    const responseProgress = saveResult.bellCreated
      ? {
          ...authoritativeProgress,
          status: {
            ...authoritativeProgress.status,
            bellRequestId:
              authoritativeProgress.status.bellRequestId ?? bellRequest?.bellRequestId ?? null,
            command: BELL_COMMAND.STOP_REQUEST,
          },
        }
      : authoritativeProgress;

    return {
      httpStatus: 200,
      body: toResponseBody(responseProgress, {
        message: saveResult.bellCreated
          ? "이동 상태를 갱신하고 하차벨 요청을 생성했습니다."
          : "이동 상태를 갱신했습니다.",
        source: parsed.data.source,
        timestamp,
        shouldTriggerBell: saveResult.bellCreated,
      }),
    };
  }

  return {
    httpStatus: 200,
    body: toResponseBody(
      {
        trip: progressData.trip,
        status: {
          ...progressData.status,
          ...status,
          bellRequestId,
          command,
        },
      },
      {
        message: shouldTriggerBell
          ? "이동 상태를 갱신하고 하차벨 요청을 생성했습니다."
          : "이동 상태를 갱신했습니다.",
        source: parsed.data.source,
        timestamp,
        shouldTriggerBell,
        ...(locationStale.isStale
          ? { locationStatus: "STALE" as const, locationGapSeconds: locationStale.staleSeconds }
          : {}),
      },
    ),
  };
}

function calculateProgress(
  progressData: TripProgressData,
  location: UpdateTripStatusRequest,
  isStale: boolean,
) {
  const stationList = progressData.trip.stationList;
  const nearestIndex = findNearestStationIndex(stationList, location.latitude, location.longitude);
  const previousIndex = findStationIndex(stationList, progressData.status.currentStation);
  let acceptedIndex = nearestIndex;
  let locationAccepted = true;
  let reason: LocationLogCreateRecord["reason"] = null;

  if (previousIndex >= 0 && nearestIndex < previousIndex) {
    acceptedIndex = previousIndex;
    locationAccepted = false;
    reason = "BACKWARD_STATION_IGNORED";
  } else if (previousIndex >= 0 && nearestIndex > previousIndex + 1 && isStale) {
    reason = "FORWARD_GAP_RECOVERED";
  } else if (previousIndex >= 0 && nearestIndex > previousIndex + 1) {
    acceptedIndex = previousIndex + 1;
    reason = "FORWARD_JUMP_CLAMPED";
  }

  const currentStation = stationList[acceptedIndex] ?? null;
  const nextStation = stationList[acceptedIndex + 1] ?? null;
  const remainingStations = Math.max(0, stationList.length - 1 - acceptedIndex);

  return {
    currentStation,
    nextStation,
    remainingStations,
    tripStatus: getTripStatus(remainingStations),
    locationAccepted,
    reason,
  };
}

function toResponseBody(
  progressData: TripProgressData,
  options: {
    message: string;
    timestamp: string;
    source?: UpdateTripStatusRequest["source"];
    shouldTriggerBell?: boolean;
    locationStatus?: "STALE";
    locationGapSeconds?: number;
  },
): UpdateTripStatusSuccessBody {
  const shouldTriggerBell = options.shouldTriggerBell ?? false;
  const body: UpdateTripStatusSuccessBody = {
    success: true,
    tripId: progressData.trip.tripId,
    destination: progressData.trip.destination,
    routeNo: progressData.trip.routeNo,
    currentStation: progressData.status.currentStation,
    nextStation: progressData.status.nextStation,
    remainingStations: progressData.status.remainingStations,
    tripStatus: progressData.status.tripStatus,
    boardingMethod: progressData.status.boardingMethod,
    boardingConfirmedAt: progressData.status.boardingConfirmedAt,
    bellStatus: progressData.status.bellStatus,
    shouldTriggerBell,
    command: progressData.status.command,
    guideMessage:
      progressData.status.tripStatus === TRIP_STATUS.WAITING_BUS
        ? "버스 탑승을 기다리고 있습니다."
        : buildGuideMessage(
            progressData.status.remainingStations,
            progressData.status.bellStatus,
            shouldTriggerBell,
          ),
    message: options.message,
    timestamp: options.timestamp,
  };

  if (progressData.status.bellRequestId) {
    body.bellRequestId = progressData.status.bellRequestId;
  }
  if (options.source) {
    body.source = options.source;
  }
  if (options.locationStatus) {
    body.locationStatus = options.locationStatus;
    if (options.locationGapSeconds !== undefined) {
      body.locationGapSeconds = options.locationGapSeconds;
    }
    body.locationWarning = "위치 정보 업데이트가 지연되었습니다. 현재 위치를 다시 확인합니다.";
  }

  return body;
}

function hasConfirmedBoarding(progressData: TripProgressData) {
  return Boolean(
    progressData.status.boardingMethod && progressData.status.boardingConfirmedAt,
  );
}

function hasInconsistentBoardingState(progressData: TripProgressData) {
  const confirmed = hasConfirmedBoarding(progressData);
  const hasAnyBoardingMetadata = Boolean(
    progressData.status.boardingMethod || progressData.status.boardingConfirmedAt,
  );
  const status = progressData.status.tripStatus;

  return (
    (status === TRIP_STATUS.WAITING_BUS && hasAnyBoardingMetadata) ||
    ([TRIP_STATUS.ON_BUS, TRIP_STATUS.NEAR_DESTINATION, TRIP_STATUS.TRIP_DONE].includes(
      status as typeof TRIP_STATUS.ON_BUS,
    ) && !confirmed)
  );
}

function findNearestStationIndex(stationList: Station[], latitude: number, longitude: number) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  stationList.forEach((station, index) => {
    const distance = haversineKm(latitude, longitude, station.latitude, station.longitude);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Radians = (lat1 * Math.PI) / 180;
  const lat2Radians = (lat2 * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Radians) * Math.cos(lat2Radians) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPositiveGapSeconds(previousRecordedAt: string | null, recordedAt: string) {
  if (!previousRecordedAt) return null;
  const previousMs = Date.parse(previousRecordedAt);
  const currentMs = Date.parse(recordedAt);
  if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs) || currentMs <= previousMs) {
    return null;
  }
  return Math.floor((currentMs - previousMs) / 1000);
}

function isLocationStale(
  status: TripProgressData["status"],
  location: UpdateTripStatusRequest,
) {
  const sameAsLast =
    status.lastLatitude === location.latitude && status.lastLongitude === location.longitude;
  const unchangedSince = status.locationChangedAt ?? status.recordedAt;
  const unchangedSeconds = getPositiveGapSeconds(unchangedSince, location.recordedAt);
  const requestGapSeconds = getPositiveGapSeconds(status.recordedAt, location.recordedAt);
  const staleSeconds = Math.max(unchangedSeconds ?? 0, requestGapSeconds ?? 0);

  return {
    sameAsLast,
    isStale: staleSeconds * 1000 > STALE_LOCATION_GAP_MS,
    staleSeconds,
  };
}

function findStationIndex(stationList: Station[], station: Station | null) {
  if (!station) return -1;
  return stationList.findIndex((candidate) => sameStation(candidate, station));
}

function sameStation(left: Station, right: Station) {
  return (
    left.stationName === right.stationName &&
    left.latitude === right.latitude &&
    left.longitude === right.longitude
  );
}

function getTripStatus(remainingStations: number) {
  if (remainingStations === 0) return TRIP_STATUS.TRIP_DONE;
  if (remainingStations === 1) return TRIP_STATUS.NEAR_DESTINATION;
  return TRIP_STATUS.ON_BUS;
}

