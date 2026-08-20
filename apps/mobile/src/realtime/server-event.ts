export type RealtimeErrorDetails = {
  code?: string;
  clientEventId?: string;
};

/** Realtime error의 error.event_id는 오류를 일으킨 클라이언트 이벤트 ID다. */
export function getRealtimeErrorDetails(
  serverEvent: Record<string, unknown>,
): RealtimeErrorDetails {
  const error = serverEvent.error as Record<string, unknown> | undefined;

  return {
    code: typeof error?.code === "string" ? error.code : undefined,
    clientEventId:
      typeof error?.event_id === "string" ? error.event_id : undefined,
  };
}
