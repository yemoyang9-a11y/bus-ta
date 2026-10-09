import {
  createAssistDeviceStatusEvent,
  createBeaconLookupFailureEvent,
} from './assist-device-status';
import type { AppAction, AssistDeviceStatusChangedEvent } from './types';

type BeaconData = {
  targetBeaconId?: string;
  isMock?: boolean;
};

type PreparationDependencies = {
  getActiveTripId: () => string | null;
  isWaitingForBus?: () => boolean;
  wait?: (ms: number) => Promise<void>;
  releaseCane?: () => Promise<boolean>;
  listBeacons: (routeNo: string) => Promise<BeaconData>;
  getBeaconLookupErrorCode?: (error: unknown) => string | undefined;
  /**
   * 지팡이만 연결한다. 하차벨 보드는 이 시점에 물리적으로 범위 밖이라 같이 찾지 않는다.
   * 탑승이 확정된 뒤 화면에서 따로 연결한다.
   */
  connectCane: () => Promise<unknown>;
  setTargetBeacon: (targetBeaconId: string) => Promise<void>;
  startBeaconScan: () => Promise<void>;
  notifyFailure: (event: AssistDeviceStatusChangedEvent) => void;
  dispatch: (action: AppAction) => void;
};

type PreparationInput = {
  tripId: string;
  routeNo: string;
};

export function createAssistDevicePreparation(
  dependencies: PreparationDependencies,
) {
  let preparedTripId: string | null = null;
  let activePreparation = Promise.resolve();

  let ownerTripId: string | null = null;
  let cancelWait: (() => void) | null = null;
  const wait = dependencies.wait ?? ((ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { cancelWait = null; resolve(); }, ms);
    cancelWait = () => { clearTimeout(timer); cancelWait = null; resolve(); };
  }));
  const isWaiting = (tripId: string) => isActiveTrip(tripId) && (dependencies.isWaitingForBus?.() ?? true);

  const isActiveTrip = (tripId: string) =>
    dependencies.getActiveTripId() === tripId;

  const runPreparation = async ({ tripId, routeNo }: PreparationInput) => {
    if (!isActiveTrip(tripId)) return;

    let beaconData: BeaconData | null = null;
    try {
      beaconData = await dependencies.listBeacons(routeNo);
    } catch (error) {
      if (isActiveTrip(tripId)) {
        dependencies.notifyFailure(
          createBeaconLookupFailureEvent(
            dependencies.getBeaconLookupErrorCode?.(error),
          ),
        );
      }
    }

    if (!isActiveTrip(tripId)) return;

    // 준비 단계에서는 지팡이만 연결한다.
    //
    // 하차벨 보드는 버스에 달려 있어서 정류장에서 기다리는 동안에는 BLE 범위 밖이다.
    // 예전에는 여기서 둘을 한 번에 찾고 실패를 확정해 버렸는데, 그러면 정작 버스에
    // 탄 뒤에는 다시 찾지 않아 하차벨이 영영 붙지 않았다. 2026-09-04 실차에서 두 번
    // 다 이렇게 실패했다. 하차벨 연결은 탑승 확정 뒤 화면이 맡는다.
    let canConnect = true;
    if (ownerTripId && ownerTripId !== tripId && dependencies.releaseCane) {
      canConnect = await dependencies.releaseCane();
      if (canConnect) ownerTripId = null;
    }
    let cane: unknown = null;
    let attempts = 0;
    while (canConnect && isWaiting(tripId) && attempts < 3) {
      attempts++;
      try { cane = await dependencies.connectCane(); } catch { cane = null; }
      if (cane != null) { ownerTripId = tripId; break; }
      if (isWaiting(tripId) && attempts < 3) await wait(attempts * 1000);
    }
    if (!isActiveTrip(tripId)) return;
    const caneConnected = cane != null;
    if (!caneConnected && isWaiting(tripId)) {
      dependencies.notifyFailure(createAssistDeviceStatusEvent({
        device: 'CANE', reason: canConnect ? 'NOT_CONNECTED' : 'COMMAND_FAILED', attempted: attempts > 0,
        retryable: false, attempts,
      }));
    }

    // 실물 연동 시험에서는 지팡이가 연결된 직후 타겟을 지정하고 스캔을 시작한다.
    // 두 GATT Write를 반드시 순서대로 기다려 타겟이 적용되기 전에 스캔이 켜지는
    // 경합을 막는다.
    if (isWaiting(tripId) && caneConnected && beaconData?.targetBeaconId) {
      try {
        await dependencies.setTargetBeacon(beaconData.targetBeaconId);
        if (isWaiting(tripId)) await dependencies.startBeaconScan();
        if (!isWaiting(tripId)) {
          if (dependencies.releaseCane && await dependencies.releaseCane()) ownerTripId = null;
        } else dependencies.dispatch({ type: 'SET_CANE_READY', ready: true });
        if (isWaiting(tripId)) dependencies.dispatch({ type: 'SET_BEACON_SCAN_ACTIVE', active: true });
      } catch {
        if (isActiveTrip(tripId)) {
          dependencies.notifyFailure(
            createAssistDeviceStatusEvent({
              device: 'CANE',
              reason: 'COMMAND_FAILED',
              attempted: true,
              retryable: true,
            }),
          );
        }
      }
    }

    if (!isActiveTrip(tripId)) return;

    // 탑승 확정 뒤 하차벨을 연결할 때 쓸 보드 이름. 노선마다 다르므로 서버 값을 남긴다.
    dependencies.dispatch({
      type: 'SET_TARGET_BEACON_ID',
      targetBeaconId: beaconData?.targetBeaconId ?? null,
    });

    // 하차벨 연결 여부는 아직 모른다. 탑승 뒤에 시도하므로 그 결과로 갱신된다.
    dependencies.dispatch({
      type: 'SET_BLE_MOCK_STATUS',
      isMock: beaconData?.isMock ?? false,
    });

    // 비콘 조회/준비가 끝났음을 마지막에 표시한다.
    // 이 시점부터 targetBeaconId가 null이면 아직 조회 중인 것이 아니라 실제 조회 결과가 없는 것이다.
    dependencies.dispatch({
      type: 'SET_BEACON_PREPARATION_COMPLETED',
      completed: true,
    });
  };

  return {
    release: (tripId: string) => {
      cancelWait?.();
      activePreparation = activePreparation.then(async () => {
        if (ownerTripId !== tripId || !dependencies.releaseCane) return;
        if (await dependencies.releaseCane()) ownerTripId = null;
      }).catch(() => undefined);
      return activePreparation;
    },
    prepare: (input: PreparationInput) => {
      if (
        !input.tripId ||
        !isActiveTrip(input.tripId) ||
        preparedTripId === input.tripId
      ) {
        return activePreparation;
      }

      preparedTripId = input.tripId;
      activePreparation = activePreparation
        .then(() => runPreparation(input))
        .catch(() => undefined);
      return activePreparation;
    },
  };
}
