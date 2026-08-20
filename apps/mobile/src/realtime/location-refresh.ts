export type CurrentLocation = {
  latitude: number;
  longitude: number;
};

type LocationRefreshRequest = {
  requestPermission: () => Promise<string>;
  getPosition: () => Promise<CurrentLocation>;
};

type LocationRefreshCoordinatorOptions = {
  setLocation: (location: CurrentLocation | undefined) => void;
};

/**
 * 동시에 실행되는 위치 요청의 결과를 안전하게 합친다.
 *
 * - 일시적인 조회 오류는 이전의 유효 좌표를 보존한다.
 * - 더 최신 성공 뒤에 도착한 오래된 성공은 좌표를 덮지 않는다.
 * - 권한 거부는 가장 최신 요청일 때만 좌표를 비운다.
 * - 권한 거부보다 먼저 시작한 요청의 늦은 성공은 무시한다.
 */
export function createLocationRefreshCoordinator({
  setLocation,
}: LocationRefreshCoordinatorOptions) {
  let latestStartedRequestId = 0;
  let latestSuccessfulRequestId = 0;
  let latestPermissionDeniedRequestId = 0;

  return async function refreshLocation({
    requestPermission,
    getPosition,
  }: LocationRefreshRequest): Promise<void> {
    const requestId = ++latestStartedRequestId;
    const permissionStatus = await requestPermission();

    if (permissionStatus !== "granted") {
      if (requestId === latestStartedRequestId) {
        latestPermissionDeniedRequestId = requestId;
        setLocation(undefined);
      }
      return;
    }

    // 예외는 호출부로 전달하되 기존 좌표는 변경하지 않는다.
    const location = await getPosition();

    if (
      requestId < latestSuccessfulRequestId ||
      requestId < latestPermissionDeniedRequestId
    ) {
      return;
    }

    latestSuccessfulRequestId = requestId;
    setLocation(location);
  };
}
