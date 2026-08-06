export const REALTIME_MODEL = "gpt-realtime-mini" as const;
export const REALTIME_SHARED_SECRET_HEADER = "x-realtime-shared-secret" as const;

export const REALTIME_SESSION_ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  REALTIME_SESSION_FAILED: "REALTIME_SESSION_FAILED",
} as const;

export type RealtimeSessionErrorCode =
  (typeof REALTIME_SESSION_ERROR_CODES)[keyof typeof REALTIME_SESSION_ERROR_CODES];
