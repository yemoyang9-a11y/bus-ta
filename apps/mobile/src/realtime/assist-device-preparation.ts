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

    if (caneConnected && beaconData?.targetBeaconId) {
      try {
        await dependencies.setTargetBeacon(beaconData.targetBeaconId);
        if (!isActiveTrip(tripId)) return;
        await dependencies.startBeaconScan();
        if (!isActiveTrip(tripId)) return;
        dependencies.dispatch({
          type: 'SET_BEACON_SCAN_ACTIVE',
          active: true,
        });
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
