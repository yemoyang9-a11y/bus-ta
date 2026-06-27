import { randomUUID } from "node:crypto";
import {
  BELL_COMMAND,
  BELL_STATUS,
  TRIP_STATUS,
  UpdateTripStatusRequestSchema,
  type CreateTripRequest,
  type UpdateTripStatusRequest,
} from "@bus-ta/shared";

type Station = CreateTripRequest["stationList"][number];

export interface TripProgressData {
  trip: {
    tripId: string;
    destination: string;
    routeNo: string;
    stationList: Station[];
  };
  status: {
    tripId: string;
    currentStation: Station | null;
    nextStation: Station | null;
    remainingStations: number;
    tripStatus: string;
    bellStatus: string;
    bellRequestId: string | null;
    command: "STOP_REQUEST" | null;
    lastRequestId: string | null;
    locationSource: string | null;
    recordedAt: string | null;
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
  reason: "BACKWARD_STATION_IGNORED" | "FORWARD_JUMP_CLAMPED" | null;
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

export interface UpdateTripStatusRepository {
  findTripProgressData(tripId: string): Promise<TripProgressData | null>;
  findLocationLogByRequestId(tripId: string, requestId: string): Promise<LocationLogLookup | null>;
  saveStatusAndLocation(data: SaveStatusAndLocationInput): Promise<void>;
}

export interface UpdateTripStatusDependencies extends UpdateTripStatusRepository {
  now?: () => string;
  generateBellRequestId?: () => string;
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
  bellStatus: string;
  shouldTriggerBell: boolean;
  bellRequestId?: string;
  command: typeof BELL_COMMAND.STOP_REQUEST | null;
  guideMessage: string;
  source?: UpdateTripStatusRequest["source"];
  message: string;
  timestamp: string;
};

type UpdateTripStatusErrorBody = {
  success: false;
  errorCode: "INVALID_REQUEST" | "TRIP_NOT_FOUND" | "DB_ERROR";
  message: string;
  timestamp: string;
};

export type UpdateTripStatusResult =
  | { httpStatus: 200; body: UpdateTripStatusSuccessBody }
  | { httpStatus: 400; body: UpdateTripStatusErrorBody }
  | { httpStatus: 404; body: UpdateTripStatusErrorBody }
  | { httpStatus: 500; body: UpdateTripStatusErrorBody };

const defaultNow = () => new Date().toISOString();
const defaultGenerateBellRequestId = () => `bell-${randomUUID()}`;

export async function updateTripStatus(
  tripId: string,
  input: unknown,
  dependencies: UpdateTripStatusDependencies,
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

  const progressData = await dependencies.findTripProgressData(tripId);
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

  const duplicate = await dependencies.findLocationLogByRequestId(tripId, parsed.data.requestId);
  if (duplicate) {
    return {
      httpStatus: 200,
      body: toResponseBody(progressData, {
        message: "이미 처리된 위치 업데이트입니다.",
        timestamp,
      }),
    };
  }

  const progress = calculateProgress(progressData, parsed.data);

  // 5단계: 하차 1정거장 전 하차벨 자동 요청 생성.
  // remainingStations=1 & bellStatus=NOT_REQUESTED 일 때만 STOP_REQUEST 를 생성하고 PENDING 으로 전환한다.
  // PENDING/SUCCESS/FAIL 이면 중복 생성하지 않는다.
  const shouldTriggerBell =
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
    updatedAt: timestamp,
  };

  try {
    await dependencies.saveStatusAndLocation({
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
  } catch {
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
        message: shouldTriggerBell ? "하차벨 요청을 생성했습니다." : "이동 상태를 갱신했습니다.",
        source: parsed.data.source,
        timestamp,
        shouldTriggerBell,
      },
    ),
  };
}

function calculateProgress(progressData: TripProgressData, location: UpdateTripStatusRequest) {
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
    bellStatus: progressData.status.bellStatus,
    shouldTriggerBell,
    command: progressData.status.command,
    guideMessage: getGuideMessage(
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

  return body;
}

function findNearestStationIndex(stationList: Station[], latitude: number, longitude: number) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  stationList.forEach((station, index) => {
    const distance = Math.hypot(station.latitude - latitude, station.longitude - longitude);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
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
  if (remainingStations <= 2) return TRIP_STATUS.NEAR_DESTINATION;
  return TRIP_STATUS.ON_BUS;
}

function getGuideMessage(remainingStations: number, bellStatus: string, shouldTriggerBell = false) {
  if (remainingStations === 0) {
    return "목적지 정류장에 도착했습니다.";
  }
  if (shouldTriggerBell) {
    return "하차벨을 요청했습니다. 하차를 준비하세요.";
  }
  if (remainingStations === 1 && bellStatus === BELL_STATUS.NOT_REQUESTED) {
    return "하차까지 한 정류장 남았습니다. 하차벨 요청을 준비합니다.";
  }
  if (remainingStations === 2) {
    return "하차까지 두 정류장 남았습니다. 하차 준비를 시작하세요.";
  }
  if (bellStatus === BELL_STATUS.PENDING) {
    return "하차벨 요청 결과를 기다리고 있습니다.";
  }
  return "이동 상태를 갱신했습니다.";
}
