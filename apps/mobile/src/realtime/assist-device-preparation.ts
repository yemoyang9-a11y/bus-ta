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
  listBeacons: (routeNo: string) => Promise<BeaconData>;
  getBeaconLookupErrorCode?: (error: unknown) => string | undefined;
  /**
   * 지팡이만 연결한다. 하차벨 보드는 이 시점에 물리적으로 범위 밖이라 같이 찾지 않는다.
   * 탑승이 확정된 뒤 화면에서 따로 연결한다.
   */
  connectCane: () => Promise<unknown>;
  setTargetBeacon: (targetBeaconId: string) => Promise<void>;
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
    let cane: unknown;
    try {
      cane = await dependencies.connectCane();
    } catch {
      cane = null;
    }

    if (!isActiveTrip(tripId)) return;

    const caneConnected = cane != null;

    if (!caneConnected) {
      dependencies.notifyFailure(
        createAssistDeviceStatusEvent({
          device: 'CANE',
          reason: 'NOT_CONNECTED',
          attempted: true,
          retryable: true,
        }),
      );
    }

    // 여기서는 지팡이에 "무엇을 찾을지"만 알려주고 스캔은 켜지 않는다.
    //
    // 스캔을 켜는 시점은 서버가 정한다. 도착 예정 5분 이하가 되면 GET /status 가
    // shouldScanBeacon 을 내려주고, 그때 RidingScreen 이 startBeaconScan() 을
    // 호출한다. 운행을 만들자마자 켜면 두 가지가 어긋난다. 하나는 서버가 정한
    // 호출 정책을 앱이 앞질러 배터리를 쓰는 것이고, 다른 하나는 지팡이와 비콘
    // 보드가 가까이 있을 때 버스가 오기도 전에 진동이 시작되는 것이다.
    // 후자는 "버스가 가까워지면 진동이 울린다"를 확인할 수 없게 만든다.
    if (caneConnected && beaconData?.targetBeaconId) {
      try {
        await dependencies.setTargetBeacon(beaconData.targetBeaconId);
        if (!isActiveTrip(tripId)) return;
        // 지팡이가 무엇을 찾을지 알게 됐다. 이제 스캔 명령을 받을 수 있다.
        // 서버의 스캔 시작 신호가 이 시점보다 먼저 도착했을 수 있으므로, 화면이
        // 이 값의 변화를 보고 그때 startBeaconScan() 을 실행한다.
        dependencies.dispatch({ type: 'SET_CANE_READY', ready: true });
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