import {
  createAssistDeviceConnectionFailureEvents,
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
  connectAll: () => Promise<ReadonlyMap<string, unknown>>;
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

    let connected: ReadonlyMap<string, unknown>;
    try {
      connected = await dependencies.connectAll();
    } catch {
      if (isActiveTrip(tripId)) {
        dependencies.notifyFailure(
          createAssistDeviceConnectionFailureEvents(false, false)[0],
        );
        dependencies.dispatch({
          type: 'SET_BLE_MOCK_STATUS',
          isMock: true,
        });
      }
      return;
    }

    if (!isActiveTrip(tripId)) return;

    const caneConnected = connected.has('White_cane');
    const bellConnected = connected.has('BUS_1551_001');

    for (const event of createAssistDeviceConnectionFailureEvents(
      caneConnected,
      bellConnected,
    )) {
      if (!isActiveTrip(tripId)) return;
      dependencies.notifyFailure(event);
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
    dependencies.dispatch({
      type: 'SET_BLE_MOCK_STATUS',
      isMock: (beaconData?.isMock ?? false) || !bellConnected,
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
