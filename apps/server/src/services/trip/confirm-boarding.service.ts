import {
  BoardingConfirmationRequestSchema,
  TRIP_STATUS,
  type BoardingConfirmationRequest,
  type BoardingConfirmationResponse,
  type BoardingMethod,
} from "@bus-ta/shared";
import type { TripProgressData } from "./update-trip-status.service.js";

export interface ConfirmBoardingPersistenceInput {
  tripId: string;
  requestId: string;
  boardingMethod: BoardingMethod;
  detectedAt: string | null;
  confirmedAt: string;
}

export type ConfirmBoardingPersistenceResult =
  | "CONFIRMED"
  | "ALREADY_CONFIRMED"
  | "TRIP_NOT_FOUND"
  | "INVALID_STATUS"
  | "INCONSISTENT";

export interface ConfirmBoardingDependencies {
  confirmBoarding(data: ConfirmBoardingPersistenceInput): Promise<ConfirmBoardingPersistenceResult>;
  findTripProgressData(tripId: string): Promise<TripProgressData | null>;
  now?: () => string;
}

type ConfirmBoardingErrorBody = {
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

export type ConfirmBoardingResult =
  | { httpStatus: 200; body: BoardingConfirmationResponse }
  | { httpStatus: 400 | 404 | 409 | 500; body: ConfirmBoardingErrorBody };

const defaultNow = () => new Date().toISOString();

export async function confirmBoarding(
  tripId: string,
  input: unknown,
  dependencies: ConfirmBoardingDependencies,
): Promise<ConfirmBoardingResult> {
  const now = dependencies.now ?? defaultNow;
  const timestamp = now();
  const parsed = BoardingConfirmationRequestSchema.safeParse(input);

  if (
    !parsed.success ||
    !tripId.trim() ||
    isDetectedAfterConfirmation(parsed.data, timestamp)
  ) {
    return errorResult(
      400,
      "INVALID_REQUEST",
      "요청 데이터가 올바르지 않습니다.",
      timestamp,
    );
  }

  let persistenceResult: ConfirmBoardingPersistenceResult;
  try {
    persistenceResult = await dependencies.confirmBoarding({
      tripId,
      requestId: parsed.data.requestId,
      boardingMethod: parsed.data.boardingMethod,
      detectedAt: parsed.data.boardingMethod === "AUTO_DETECTED" ? parsed.data.detectedAt ?? null : null,
      confirmedAt: timestamp,
    });
  } catch {
    return errorResult(500, "DB_ERROR", "탑승 상태를 저장하지 못했습니다.", timestamp);
  }

  if (persistenceResult === "TRIP_NOT_FOUND") {
    return errorResult(404, "TRIP_NOT_FOUND", "운행 정보를 찾을 수 없습니다.", timestamp);
  }
  if (persistenceResult === "INVALID_STATUS") {
    return errorResult(
      409,
      "INVALID_TRIP_STATUS",
      "현재 운행 상태에서는 탑승을 확정할 수 없습니다.",
      timestamp,
    );
  }
  if (persistenceResult === "INCONSISTENT") {
    return errorResult(
      409,
      "BOARDING_STATE_INCONSISTENT",
      "운행 상태와 탑승 근거가 일치하지 않습니다.",
      timestamp,
    );
  }

  let progressData: TripProgressData | null;
  try {
    progressData = await dependencies.findTripProgressData(tripId);
  } catch {
    return errorResult(500, "DB_ERROR", "탑승 상태를 조회하지 못했습니다.", timestamp);
  }

  if (!progressData) {
    return errorResult(404, "TRIP_NOT_FOUND", "운행 정보를 찾을 수 없습니다.", timestamp);
  }

  const { status } = progressData;
  if (
    (status.tripStatus !== TRIP_STATUS.ON_BUS &&
      status.tripStatus !== TRIP_STATUS.NEAR_DESTINATION) ||
    !status.boardingMethod ||
    !status.boardingConfirmedAt
  ) {
    return errorResult(
      409,
      "BOARDING_STATE_INCONSISTENT",
      "운행 상태와 탑승 근거가 일치하지 않습니다.",
      timestamp,
    );
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      tripId,
      tripStatus: status.tripStatus,
      boardingMethod: status.boardingMethod,
      boardingConfirmedAt: status.boardingConfirmedAt,
      message:
        persistenceResult === "ALREADY_CONFIRMED"
          ? "이미 확인된 버스 탑승 상태입니다."
          : "버스 탑승을 확인했습니다.",
      timestamp,
    },
  };
}

function isDetectedAfterConfirmation(
  input: BoardingConfirmationRequest,
  confirmedAt: string,
): boolean {
  if (input.boardingMethod !== "AUTO_DETECTED" || input.detectedAt === undefined) {
    return false;
  }

  return Date.parse(input.detectedAt) > Date.parse(confirmedAt);
}

function errorResult(
  httpStatus: 400 | 404 | 409 | 500,
  errorCode: ConfirmBoardingErrorBody["errorCode"],
  message: string,
  timestamp: string,
): ConfirmBoardingResult {
  return {
    httpStatus,
    body: { success: false, errorCode, message, timestamp },
  };
}
