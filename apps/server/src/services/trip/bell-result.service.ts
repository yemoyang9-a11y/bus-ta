import { BELL_STATUS, BellResultSchema, type TripStatus } from "@bus-ta/shared";

export interface SaveBellResultInput {
  tripId: string;
  bellRequestId: string;
  result: typeof BELL_STATUS.SUCCESS | typeof BELL_STATUS.FAIL;
  resultMessage: string | null;
  isMock: boolean;
  completedAt: string;
}

export type SaveBellResultResult =
  | { outcome: "BELL_REQUEST_NOT_FOUND" }
  | { outcome: "INVALID_BELL_STATE" }
  | {
      outcome: "SAVED" | "ALREADY_RECORDED";
      tripId: string;
      bellRequestId: string;
      bellStatus: typeof BELL_STATUS.SUCCESS | typeof BELL_STATUS.FAIL;
      tripStatus: TripStatus;
    };

export interface BellResultRepository {
  /** Validate, lock, save both rows, and return the authoritative first result atomically. */
  saveBellResult(data: SaveBellResultInput): Promise<SaveBellResultResult>;
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

  let saved: SaveBellResultResult;
  try {
    saved = await dependencies.saveBellResult({
      tripId,
      bellRequestId,
      result,
      resultMessage: resultMessage ?? null,
      isMock: isMock ?? true,
      completedAt: timestamp,
    });
  } catch {
    return dbError(timestamp);
  }

  if (saved.outcome === "BELL_REQUEST_NOT_FOUND") {
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

  if (saved.outcome === "INVALID_BELL_STATE") {
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

  // The RPC result wins over the incoming result and any pre-save snapshot.
  return {
    httpStatus: 200,
    body: {
      success: true,
      tripId,
      bellRequestId,
      bellStatus: saved.bellStatus,
      tripStatus: saved.tripStatus,
      message:
        saved.outcome === "ALREADY_RECORDED"
          ? "이미 처리된 하차벨 결과입니다."
          : saved.bellStatus === BELL_STATUS.SUCCESS
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
