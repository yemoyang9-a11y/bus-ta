import { BELL_STATUS, BellResultSchema } from "@bus-ta/shared";

export interface BellRequestLookup {
  tripId: string;
  bellRequestId: string;
  /** bell_logs.result — 아직 처리 전이면 null */
  result: typeof BELL_STATUS.SUCCESS | typeof BELL_STATUS.FAIL | null;
  /** trip_status.bell_status */
  bellStatus: string;
  /** trip_status.trip_status (응답용) */
  tripStatus: string;
}

export interface SaveBellResultInput {
  tripId: string;
  bellRequestId: string;
  result: typeof BELL_STATUS.SUCCESS | typeof BELL_STATUS.FAIL;
  resultMessage: string | null;
  isMock: boolean;
  completedAt: string;
  bellStatus: typeof BELL_STATUS.SUCCESS | typeof BELL_STATUS.FAIL;
}

export interface BellResultRepository {
  findBellRequest(tripId: string, bellRequestId: string): Promise<BellRequestLookup | null>;
  saveBellResult(data: SaveBellResultInput): Promise<void>;
}

export interface BellResultDependencies extends BellResultRepository {
  now?: () => string;
}

type BellResultSuccessBody = {
  success: true;
  tripId: string;
  bellRequestId: string;
  bellStatus: string;
  tripStatus: string;
  message: string;
  timestamp: string;
};

type BellResultErrorBody = {
  success: false;
  errorCode: "INVALID_REQUEST" | "BELL_REQUEST_NOT_FOUND" | "INVALID_BELL_STATE" | "DB_ERROR";
  message: string;
  timestamp: string;
};

export type BellResultResult =
  | { httpStatus: 200; body: BellResultSuccessBody }
  | { httpStatus: 400; body: BellResultErrorBody }
  | { httpStatus: 404; body: BellResultErrorBody }
  | { httpStatus: 409; body: BellResultErrorBody }
  | { httpStatus: 500; body: BellResultErrorBody };

const defaultNow = () => new Date().toISOString();

/**
 * 하차벨 결과 저장 — PENDING → SUCCESS | FAIL 로만 전환한다.
 * - NOT_REQUESTED → PENDING 전환은 하지 않는다 (그건 PATCH /status 책임).
 * - 같은 bellRequestId 재전송이면 기존 결과를 그대로 반환한다 (멱등).
 * - 이미 SUCCESS/FAIL 로 닫힌 요청에 새 결과를 덮어쓰지 않는다.
 */
export async function recordBellResult(
  tripId: string,
  input: unknown,
  dependencies: BellResultDependencies,
): Promise<BellResultResult> {
  const now = dependencies.now ?? defaultNow;
  const timestamp = now();

  const parsed = BellResultSchema.safeParse(input);
  if (!parsed.success) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        errorCode: "INVALID_REQUEST",
        message: "하차벨 결과 데이터가 올바르지 않습니다.",
        timestamp,
      },
    };
  }

  const { bellRequestId, result, resultMessage, isMock } = parsed.data;

  let lookup: BellRequestLookup | null;
  try {
    lookup = await dependencies.findBellRequest(tripId, bellRequestId);
  } catch {
    return dbError(timestamp);
  }

  if (!lookup) {
    return {
      httpStatus: 404,
      body: {
        success: false,
        errorCode: "BELL_REQUEST_NOT_FOUND",
        message: "하차벨 요청을 찾을 수 없습니다.",
        timestamp,
      },
    };
  }

  // 멱등: 이미 결과가 기록된 요청은 덮어쓰지 않고 기존 상태를 반환한다.
  if (lookup.result !== null) {
    return {
      httpStatus: 200,
      body: {
        success: true,
        tripId,
        bellRequestId,
        bellStatus: lookup.bellStatus,
        tripStatus: lookup.tripStatus,
        message: "이미 처리된 하차벨 결과입니다.",
        timestamp,
      },
    };
  }

  // PENDING 상태에서만 결과를 받는다.
  if (lookup.bellStatus !== BELL_STATUS.PENDING) {
    return {
      httpStatus: 409,
      body: {
        success: false,
        errorCode: "INVALID_BELL_STATE",
        message: "하차벨이 요청 대기(PENDING) 상태가 아닙니다.",
        timestamp,
      },
    };
  }

  const bellStatus = result === BELL_STATUS.SUCCESS ? BELL_STATUS.SUCCESS : BELL_STATUS.FAIL;

  try {
    await dependencies.saveBellResult({
      tripId,
      bellRequestId,
      result,
      resultMessage: resultMessage ?? null,
      isMock: isMock ?? true,
      completedAt: timestamp,
      bellStatus,
    });
  } catch {
    return dbError(timestamp);
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      tripId,
      bellRequestId,
      bellStatus,
      tripStatus: lookup.tripStatus,
      message:
        bellStatus === BELL_STATUS.SUCCESS
          ? "하차벨 요청이 정상 처리되었습니다."
          : "하차벨 요청이 실패했습니다.",
      timestamp,
    },
  };
}

function dbError(timestamp: string): BellResultResult {
  return {
    httpStatus: 500,
    body: {
      success: false,
      errorCode: "DB_ERROR",
      message: "하차벨 결과를 저장하지 못했습니다.",
      timestamp,
    },
  };
}
