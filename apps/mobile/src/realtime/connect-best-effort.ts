type ConnectWithBestEffortLocationOptions<T> = {
  refreshCurrentLocation: () => Promise<void>;
  connectWebRTC: () => Promise<T>;
};

type PromiseRef<T> = {
  current: Promise<T> | null;
};

/**
 * 진행 중인 연결 Promise가 있으면 그대로 재사용한다.
 * 완료되거나 실패한 뒤에는 다음 연결 시도를 새로 시작할 수 있다.
 */
export function runSingleFlight<T>(
  promiseRef: PromiseRef<T>,
  operation: () => Promise<T>,
): Promise<T> {
  if (promiseRef.current) return promiseRef.current;

  const promise = Promise.resolve()
    .then(operation)
    .finally(() => {
      if (promiseRef.current === promise) {
        promiseRef.current = null;
      }
    });

  promiseRef.current = promise;
  return promise;
}

/**
 * 위치 갱신은 백그라운드에서 시도하고, 성공 여부와 관계없이 WebRTC 연결을 진행한다.
 * 위치가 준비되지 않으면 search_routes 단계에서 기존 Dispatcher 오류로 처리한다.
 */
export async function connectWithBestEffortLocation<T>({
  refreshCurrentLocation,
  connectWebRTC,
}: ConnectWithBestEffortLocationOptions<T>): Promise<T> {
  // 일시적인 GPS 오류는 이전에 확보한 유효 좌표를 지우지 않는다.
  // 권한 거부와 좌표 갱신 순서는 location-refresh가 별도로 처리한다.
  void refreshCurrentLocation().catch(() => undefined);

  return connectWebRTC();
}
