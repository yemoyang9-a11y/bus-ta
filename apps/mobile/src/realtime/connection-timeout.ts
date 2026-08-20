export const DEFAULT_REALTIME_CONNECTION_TIMEOUT_MS = 20000;

export class RealtimeConnectionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`음성 연결이 ${timeoutMs / 1000}초 안에 완료되지 않았습니다. 다시 시도해 주세요.`);
    this.name = "RealtimeConnectionTimeoutError";
  }
}

/**
 * 세션 키 요청부터 WebRTC 연결 완료까지 하나의 제한 시간을 적용한다.
 * 제한 시간이 지나면 하위 fetch/WebRTC 작업도 정리할 수 있도록 signal을 중단한다.
 */
export async function runWithRealtimeConnectionTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_REALTIME_CONNECTION_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new RealtimeConnectionTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
