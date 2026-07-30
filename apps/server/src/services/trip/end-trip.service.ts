import { TRIP_STATUS, UpdateTripRequestSchema } from "@bus-ta/shared";
import type { TripProgressData } from "./update-trip-status.service.js";

export interface SaveEndTripStatusInput {
  tripId: string;
  tripStatus: typeof TRIP_STATUS.CANCELLED;
  updatedAt: string;
}

export type SaveEndTripStatusResult =
  | "CANCELLED"
  | "ALREADY_CANCELLED"
  | "TRIP_DONE"
  | "TRIP_NOT_FOUND";

export interface EndTripRepository {
  findTripProgressData(tripId: string): Promise<TripProgressData | null>;
  saveTripStatus(data: SaveEndTripStatusInput): Promise<SaveEndTripStatusResult>;
}

export interface EndTripDependencies extends EndTripRepository {
  now?: () => string;
}

type EndTripSuccessBody = {
  success: true;
  tripId: string;
  tripStatus: typeof TRIP_STATUS.CANCELLED;
  message: string;
  timestamp: string;
};

type EndTripErrorBody = {
  success: false;
  errorCode: "INVALID_REQUEST" | "TRIP_NOT_FOUND" | "INVALID_TRIP_STATUS" | "DB_ERROR";
  message: string;
  timestamp: string;
};

export type EndTripResult =
  | { httpStatus: 200; body: EndTripSuccessBody }
  | { httpStatus: 400; body: EndTripErrorBody }
  | { httpStatus: 404; body: EndTripErrorBody }
  | { httpStatus: 409; body: EndTripErrorBody }
  | { httpStatus: 500; body: EndTripErrorBody };

const defaultNow = () => new Date().toISOString();

export async function endTrip(
  tripId: string,
  input: unknown,
  dependencies: EndTripDependencies,
): Promise<EndTripResult> {
  const now = dependencies.now ?? defaultNow;
  const timestamp = now();
  const parsed = UpdateTripRequestSchema.safeParse(input);

  if (!parsed.success) {
    return error(400, "INVALID_REQUEST", "운행 종료 요청 데이터가 올바르지 않습니다.", timestamp);
  }

  let progressData: TripProgressData | null;
  try {
    progressData = await dependencies.findTripProgressData(tripId);
  } catch {
    return error(500, "DB_ERROR", "운행 정보를 조회하지 못했습니다.", timestamp);
  }

  if (!progressData) {
    return error(404, "TRIP_NOT_FOUND", "운행 정보를 찾을 수 없습니다.", timestamp);
  }

  if (progressData.status.tripStatus === TRIP_STATUS.CANCELLED) {
    return success(tripId, "이미 종료된 운행 안내입니다.", timestamp);
  }

  if (progressData.status.tripStatus === TRIP_STATUS.TRIP_DONE) {
    return error(409, "INVALID_TRIP_STATUS", "이미 완료된 운행은 취소할 수 없습니다.", timestamp);
  }

  try {
    const saveResult = await dependencies.saveTripStatus({
      tripId,
      tripStatus: TRIP_STATUS.CANCELLED,
      updatedAt: timestamp,
    });

    if (saveResult === "TRIP_DONE") {
      return error(409, "INVALID_TRIP_STATUS", "이미 완료된 운행은 취소할 수 없습니다.", timestamp);
    }
    if (saveResult === "TRIP_NOT_FOUND") {
      return error(404, "TRIP_NOT_FOUND", "운행 정보를 찾을 수 없습니다.", timestamp);
    }
    if (saveResult === "ALREADY_CANCELLED") {
      return success(tripId, "이미 종료된 운행 안내입니다.", timestamp);
    }
  } catch {
    return error(500, "DB_ERROR", "운행 종료를 저장하지 못했습니다.", timestamp);
  }

  return success(tripId, "운행 안내를 종료했습니다.", timestamp);
}

function success(tripId: string, message: string, timestamp: string): EndTripResult {
  return {
    httpStatus: 200,
    body: {
      success: true,
      tripId,
      tripStatus: TRIP_STATUS.CANCELLED,
      message,
      timestamp,
    },
  };
}

function error(
  httpStatus: 400 | 404 | 409 | 500,
  errorCode: EndTripErrorBody["errorCode"],
  message: string,
  timestamp: string,
): EndTripResult {
  return {
    httpStatus,
    body: {
      success: false,
      errorCode,
      message,
      timestamp,
    },
  };
}
