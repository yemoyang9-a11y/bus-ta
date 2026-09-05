import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { createSingleFlight } from './single-flight';
import { disconnectBellWithRetry } from './bell-connect-controller';

// 정민님 확인(2026-08-04): 공통 UUID, 기기 2대(지팡이/하차벨) 각각 연결
const SERVICE_UUID = '4fa45540-8201-11e5-8223-0002a5d5c51b';
const CHARACTERISTIC_UUID = '4fa45541-8201-11e5-8223-0002a5d5c51b';

const CANE_DEVICE_NAME = 'White_cane';
// 정민님 확정(2026-08-12): 이 보드가 버스 비콘+하차벨 겸용이라 이름 하나로 둘 다 처리(MOCK 제거)
//
// 노선을 바꾸면 보드 이름도 바뀌므로 기본값으로만 쓴다. 실제로는 서버가 노선별로
// 내려주는 targetBeaconId 를 넘겨 쓴다. 2026-09-04 에 시연 노선을 35 번으로 바꾸면서
// DB 는 BUS_35_001 로 바뀌었는데 이 상수는 그대로라 하차벨이 붙지 못했다.
const DEFAULT_BELL_DEVICE_NAME = 'BUS_35_001';

// 이번 운행에서 쓸 하차벨 보드 이름. 운행마다 서버 값으로 갱신한다.
let bellDeviceName = DEFAULT_BELL_DEVICE_NAME;

// 실제로 현재 연결에 성공한 하차벨 보드 이름.
// bellDeviceName은 다음 운행의 targetBeaconId로 먼저 바뀔 수 있으므로,
// 실제 연결 해제 대상은 별도로 기억한다.
let connectedBellDeviceName = null;

const manager = new BleManager();

// 연결된 기기를 device name별로 보관
const connectedDevices = new Map();
const bellOwners = new Map();
const pendingDisconnects = new Map();
const runStopBeaconScanSingleFlight = createSingleFlight();

/**
 * 한 개의 device name을 스캔해서 찾은 뒤 연결한다.
 * @param {string} deviceName
 * @returns {Promise<import('react-native-ble-plx').Device | null>} 연결 성공한 기기, 실패 시 null
 */
function scanAndConnect(deviceName, setCancel) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let attemptTimeout = null;
    let connectingDevice = null;
    let ownsScan = false;
    let connectionFinished = Promise.resolve();
    const stopOwnedScan = () => {
      if (!ownsScan) return;
      ownsScan = false;
      manager.stopDeviceScan();
    };

    const finish = (result) => {
      if (settled) return;

      settled = true;

      if (attemptTimeout) {
        clearTimeout(attemptTimeout);
        attemptTimeout = null;
      }

      stopOwnedScan();
      resolve(result);
    };

    // cane에 즉시 스캔을 양보한다. 같은 bell의 single-flight는 native 작업과
    // 늦은 성공 정리가 끝날 때까지 유지하여 같은 보드에 새 연결이 겹치지 않게 한다.
    setCancel(() => {
      if (settled || timedOut) return;
      timedOut = true;
      clearTimeout(attemptTimeout);
      stopOwnedScan();
      void (async () => {
        try {
          await connectingDevice?.cancelConnection();
        } catch (error) {
          console.log('[BLE] cane 우선 처리 중 bell 취소 실패:', error);
        }
        await connectionFinished;
        finish(null);
      })();
    });

    // P0 수정:
    // 스캔 10초 + 연결/서비스 탐색 10초를 각각 기다리면 한 번의 BLE 시도가
    // 최대 약 20초까지 늘어난다. 재시도까지 합치면 시연의 하차 판정보다
    // 연결 루프가 더 오래 살아 있을 수 있다.
    //
    // 따라서 "스캔"과 "연결"에 별도 timeout을 두지 않고,
    // 한 번의 scanAndConnect 전체에 8초의 단일 시간 예산을 둔다.
    //
    // controller는 최대 2회, 중간 대기 2초이므로:
    //   8초 + 2초 + 8초 = 최악 약 18초
    // 안에 연결 성공/실패가 확정된다.
    attemptTimeout = setTimeout(async () => {
      if (settled) {
        return;
      }

      timedOut = true;

      console.log(
        '[BLE] 장치 연결 전체 시간 초과 - 연결 시도 취소:',
        deviceName,
      );

      // 장치를 아직 발견하지 못했다면 취소할 네이티브 연결이 없다.
      if (!connectingDevice) {
        finish(null);
        return;
      }

      // 이미 connect/discover 단계라면 기존 네이티브 연결을 먼저 취소한다.
      // 취소가 끝나기 전에 finish(null) 하면 다음 재시도가 기존 연결과 겹칠 수 있다.
      try {
        await connectingDevice.cancelConnection();

        console.log(
          '[BLE] 시간 초과 연결 취소 완료:',
          deviceName,
        );
      } catch (disconnectError) {
        console.log(
          '[BLE] 시간 초과 연결 취소 실패:',
          deviceName,
          disconnectError,
        );
      } finally {
        finish(null);
      }
    }, 8000);

    ownsScan = true;
    manager.startDeviceScan(null, null, async (error, device) => {
      if (settled || timedOut) return;
      if (error) {
        console.log('[BLE] 스캔 오류:', error);
        finish(null);
        return;
      }

      if (device?.name !== deviceName || settled) {
        return;
      }

      // 같은 장치가 스캔 콜백으로 여러 번 들어와도 연결은 한 번만 시도한다.
      if (connectingDevice) {
        return;
      }

      connectingDevice = device;

      // 장치를 찾았어도 전체 8초 deadline은 해제하지 않는다.
      // 스캔에서 사용한 시간을 제외한 남은 시간만 connect/discover에 사용할 수 있다.
      stopOwnedScan();

      let markConnectionFinished;
      connectionFinished = new Promise((resolveFinished) => { markConnectionFinished = resolveFinished; });
      try {
        const connected = await device.connect();

        // timeout/cancel과 거의 동시에 connect()가 성공할 수 있다.
        // 이미 요청이 끝났다면 현재 연결로 채택하지 않고 다시 해제한다.
        if (settled || timedOut) {
          try {
            await connected.cancelConnection();
          } catch (disconnectError) {
            console.log(
              '[BLE] 시간 초과 후 늦은 연결 해제 실패:',
              deviceName,
              disconnectError,
            );
          }
          return;
        }

        await connected.discoverAllServicesAndCharacteristics();

        // 서비스 탐색 중 전체 deadline이 지나갔을 수도 있다.
        if (settled || timedOut) {
          try {
            await connected.cancelConnection();
          } catch (disconnectError) {
            console.log(
              '[BLE] 시간 초과 후 늦은 서비스 탐색 연결 해제 실패:',
              deviceName,
              disconnectError,
            );
          }
          return;
        }

        connectedDevices.set(deviceName, connected);

        // 실제 BLE 연결이 끊기는 순간 Map과 실제 하차벨 연결 기록을 함께 제거한다.
        connected.onDisconnected(() => {
          if (connectedDevices.get(deviceName) === connected) {
            connectedDevices.delete(deviceName);

            if (connectedBellDeviceName === deviceName) {
              connectedBellDeviceName = null;
            }

            console.log('[BLE] 연결 끊김:', deviceName);
          }
        });

        finish(connected);
      } catch (connectError) {
        // timeout이 먼저 처리된 뒤 cancelConnection() 때문에 connect()가 reject된
        // 경우에는 이미 실패 처리가 끝났으므로 중복 처리하지 않는다.
        if (settled || timedOut) {
          return;
        }

        console.log(
          '[BLE] 연결 실패:',
          deviceName,
          connectError,
        );
        finish(null);
      } finally {
        markConnectionFinished();
      }
    });
  });
}

// 진행 중인 연결 요청. 같은 기기를 두 화면이 동시에 찾으면 스캔을 두 번 시작하지 않고
// 먼저 시작한 요청의 결과를 함께 기다린다.
const inFlightConnects = new Map();

// BleManager 인스턴스가 하나뿐이라 스캔도 하나뿐이다. 한쪽의 stopDeviceScan() 이
// 다른 쪽 스캔을 끊으므로, 서로 다른 기기라도 스캔은 한 번에 하나만 돌린다.
// cane이 들어오면 실행 중 bell은 스캔을 즉시 반납하고, 대기열에서도 cane을 먼저 꺼낸다.
// 취소된 native bell 작업은 별도로 정리하며 같은 이름의 single-flight만 점유한다.
const connectQueue = [];
let activeConnect = null;

function pumpConnectQueue() {
  if (activeConnect || connectQueue.length === 0) return;
  const caneIndex = connectQueue.findIndex((job) => job.deviceName === CANE_DEVICE_NAME);
  const [job] = connectQueue.splice(caneIndex < 0 ? 0 : caneIndex, 1);
  activeConnect = job;
  scanAndConnect(job.deviceName, (cancel) => { job.cancel = cancel; })
    .then(job.resolve, job.reject)
    .finally(() => {
      // 양보한 bell의 늦은 완료가 현재 cane 작업을 해제하면 안 된다.
      if (activeConnect === job) activeConnect = null;
      pumpConnectQueue();
    });
}

/**
 * 한 기기를 연결한다. 같은 이름의 요청이 이미 진행 중이면 그 결과를 함께 기다리고,
 * 다른 이름이면 직렬 처리하되 cane은 진행 중 bell의 스캔을 양보받는다.
 *
 * 예모님 지적(2026-09-04): 탑승 직후 재시도가 최장 33초 살아 있는데 그 사이 하차
 * 화면으로 넘어가면 양쪽이 각자 connectBell() 을 부른다. 2026-08-13 에 한 번 없앴던
 * 스캔 충돌이 화면 사이에서 되살아난다.
 *
 * @param {string} deviceName
 * @returns {Promise<import('react-native-ble-plx').Device | null>}
 */
function connectOneByName(deviceName) {
  const inFlight = inFlightConnects.get(deviceName);
  if (inFlight) return inFlight;

  const pending = new Promise((resolve, reject) => {
    connectQueue.push({ deviceName, resolve, reject, cancel: () => {} });
  });

  const tracked = pending.finally(() => {
    if (inFlightConnects.get(deviceName) === tracked) {
      inFlightConnects.delete(deviceName);
    }
  });

  inFlightConnects.set(deviceName, tracked);
  if (deviceName === CANE_DEVICE_NAME && activeConnect?.deviceName !== CANE_DEVICE_NAME) {
    activeConnect?.cancel();
    activeConnect = null;
  }
  pumpConnectQueue();
  return tracked;
}

/**
 * 여러 개의 device name을 순서대로(하나씩) 연결한다.
 * 유나님·정민님 확인(2026-08-18): 스캔 콜백 안에서 두 기기를 거의 동시에 connect()하면
 * 폰 BLE 스택에서 한쪽(하차벨)이 계속 disconnected로 실패하는 문제를 발견.
 * 지팡이 연결이 완전히 끝난 뒤에 하차벨 연결을 시작하도록 직렬화한다.
 *
 * @param {string[]} deviceNames - 찾을 기기 이름 목록 (순서대로 연결됨)
 * @returns {Promise<Map<string, import('react-native-ble-plx').Device>>} 이름별 연결 결과
 */
async function connectByNames(deviceNames) {
  const found = new Map();

  for (const name of deviceNames) {
    const connected = await connectOneByName(name);

    if (connected) {
      found.set(name, connected);
    }
  }

  return found;
}

/**
 * 지팡이·하차벨을 순서대로 연결한다.
 * 각 기기별 성공/실패 여부를 개별적으로 반환하므로, 호출부는 필요한 기기가
 * 연결됐는지 결과 Map으로 확인해야 한다.
 */
export async function connectAll() {
  const targetBellDeviceName = bellDeviceName;
  const found = await connectByNames([CANE_DEVICE_NAME, targetBellDeviceName]);

  if (found.has(targetBellDeviceName) && bellDeviceName === targetBellDeviceName) {
    // 결과 Map은 시작 당시 대상 기준이다. 최신 운행의 대상 기록은 덮지 않는다.
    connectedBellDeviceName = targetBellDeviceName;
  }

  return found;
}

/**
 * 스마트지팡이만 연결한다. 운행을 만드는 시점에 쓴다.
 *
 * 하차벨 보드를 여기서 같이 찾지 않는 이유는 물리적으로 아직 없기 때문이다.
 * 사용자는 정류장에서 기다리는 중이고 버스는 오지 않았다. 그 시점에 10초 찾고
 * 실패로 확정하면, 정작 버스에 탄 뒤에는 다시 찾지 않아 하차벨이 영영 안 붙는다.
 * (2026-09-04 실차에서 두 번 다 이렇게 실패했다.)
 */
export async function connectCane() {
  return connectOneByName(CANE_DEVICE_NAME);
}

/**
 * 하차벨(버스 비콘 겸용) 보드를 연결한다. 탑승이 확정된 뒤에 쓴다.
 *
 * @param {string} [targetBeaconId] 서버가 노선별로 내려준 보드 이름.
 *   넘기면 이번 운행의 대상으로 기억해 두고, 이후 STOP_REQUEST 도 같은 이름으로 보낸다.
 * @param {string} [tripId] 취소/교체 시 정확한 연결을 정리하기 위한 소유 운행.
 */
export async function connectBell(targetBeaconId, tripId) {
  // targetBeaconId가 없으면 기본 하차벨 이름으로 추측해서 연결하지 않는다.
  // 서버가 현재 운행의 보드를 명확하게 지정한 경우에만 연결해야 다른 버스의
  // 하차벨에 잘못 연결되는 것을 막을 수 있다.
  if (!targetBeaconId) {
    console.log('[BLE] targetBeaconId 없음 - 하차벨 연결 중단');
    return null;
  }

  const requestedBellDeviceName = targetBeaconId;
  if (tripId) bellOwners.set(requestedBellDeviceName, tripId);
  const isOwner = () => !tripId || bellOwners.get(requestedBellDeviceName) === tripId;
  const previousBellDeviceName = connectedBellDeviceName;
  // await 전에 대상을 갱신해 이전 dead target으로 명령이 나가지 않게 한다.
  bellDeviceName = requestedBellDeviceName;
  if (previousBellDeviceName !== requestedBellDeviceName) {
    connectedBellDeviceName = null;
  }

  // 이전 운행의 하차벨이 실제로 연결돼 있는데 새 운행의 대상이 달라졌다면,
  // 캡처한 이전 실제 연결을 정리하되 해제 실패가 새 연결을 막지 않게 한다.
  if (
    previousBellDeviceName &&
    previousBellDeviceName !== requestedBellDeviceName
  ) {
    const previousDevice = connectedDevices.get(previousBellDeviceName);

    console.log(
      '[BLE] 이전 하차벨 연결 정리 후 새 하차벨 연결:',
      previousBellDeviceName,
      '->',
      requestedBellDeviceName,
    );

    try {
      await disconnect(previousBellDeviceName);
    } catch (error) {
      console.log('[BLE] 이전 하차벨 해제 실패 - 새 대상 연결 계속:', error);
    } finally {
      if (connectedDevices.get(previousBellDeviceName) === previousDevice) {
        connectedDevices.delete(previousBellDeviceName);
      }
    }
  }

  // 이전 운행 해제가 진행 중인 동일 보드만 기다린다. cane/다른 보드는 막지 않는다.
  await pendingDisconnects.get(requestedBellDeviceName)?.catch(() => undefined);
  if (!isOwner() || bellDeviceName !== requestedBellDeviceName) return null;

  const cached = connectedDevices.get(requestedBellDeviceName);
  let connected = null;
  if (cached) {
    try {
      if (await cached.isConnected()) connected = cached;
    } catch (error) {
      console.log('[BLE] 기존 하차벨 연결 확인 실패:', error);
    }
    if (!connected) {
      if (connectedDevices.get(requestedBellDeviceName) === cached) {
        connectedDevices.delete(requestedBellDeviceName);
        if (connectedBellDeviceName === requestedBellDeviceName) {
          connectedBellDeviceName = null;
        }
      }
      try {
        await cached.cancelConnection();
      } catch (error) {
        console.log('[BLE] stale 하차벨 정리 실패 - 재연결 계속:', error);
      }
    }
  }

  if (!isOwner() || bellDeviceName !== requestedBellDeviceName) return null;
  connected = connected ?? await connectOneByName(requestedBellDeviceName);

  if (!connected) {
    return null;
  }

  if (!isOwner()) {
    // 새 운행이 같은 보드를 인수했다면 이전 운행이 그 연결을 끊지 않는다.
    if (!bellOwners.has(requestedBellDeviceName)) {
      await disconnect(requestedBellDeviceName).catch((error) => {
        console.log('[BLE] 취소 운행의 늦은 연결 해제 실패:', error);
      });
    }
    return null;
  }

  // 연결을 기다리는 동안 다른 운행이 시작돼 목표 보드가 바뀔 수 있다.
  // 그런 늦은 성공은 현재 운행의 연결로 채택하지 않는다.
  if (bellDeviceName !== requestedBellDeviceName) {
    console.log(
      '[BLE] 이전 대상 하차벨이 늦게 연결됨 - 연결 정리:',
      requestedBellDeviceName,
    );

    try {
      await connected.cancelConnection();
    } catch (disconnectError) {
      console.log(
        '[BLE] 늦은 하차벨 연결 해제 실패:',
        requestedBellDeviceName,
        disconnectError,
      );
    } finally {
      if (connectedDevices.get(requestedBellDeviceName) === connected) {
        connectedDevices.delete(requestedBellDeviceName);
      }
    }

    return null;
  }

  connectedBellDeviceName = requestedBellDeviceName;
  return connected;
}

/** 스마트지팡이(White_cane) 연결 여부를 확인한다. */
export function isCaneConnected() {
  return connectedDevices.has(CANE_DEVICE_NAME);
}

/**
 * 하차벨(버스 비콘 겸용) 연결 여부를 실제 장치에 물어 확인한다.
 *
 * Map 에 있는지만 보면 안 된다. onDisconnected 가 놓친 경우(예: 앱이 잠깐 멈춘 사이의
 * 해제)에도 Map 에는 남아 있을 수 있다. 명령을 보내기 직전에는 실제 상태를 확인하고,
 * 끊겼으면 Map 에서 지워 다음 연결이 새로 스캔하게 한다.
 */
export async function isBellConnected() {
  const deviceName = connectedBellDeviceName ?? bellDeviceName;
  const device = connectedDevices.get(deviceName);

  if (!device) return false;

  try {
    const connected = await device.isConnected();

    if (!connected) {
      connectedDevices.delete(deviceName);

      if (connectedBellDeviceName === deviceName) {
        connectedBellDeviceName = null;
      }
    }

    return connected;
  } catch (error) {
    console.log('[BLE] 하차벨 연결 확인 실패:', error);
    connectedDevices.delete(deviceName);

    if (connectedBellDeviceName === deviceName) {
      connectedBellDeviceName = null;
    }

    return false;
  }
}

/**
 * 현재 실제 연결된 하차벨 이름을 우선 반환한다.
 * 실제 연결이 없다면 이번 운행의 목표 보드 이름을 반환한다.
 */
export function getBellDeviceName() {
  return connectedBellDeviceName ?? bellDeviceName;
}

/**
 * 연결된 기기에 문자열 명령을 Write한다.
 * @param {string} deviceName
 * @param {string} payload - 전송할 문자열 (평문 또는 JSON 문자열)
 */
async function writeCommand(deviceName, payload) {
  const device = connectedDevices.get(deviceName);

  if (!device) {
    throw new Error(
      `BLE_NOT_CONNECTED: ${deviceName}에 연결되어 있지 않습니다.`,
    );
  }

  const base64Payload = Buffer.from(payload, 'utf-8').toString('base64');

  await device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHARACTERISTIC_UUID,
    base64Payload,
  );
}

// ── 스마트지팡이 명령 ──────────────────────────────

/**
 * 지팡이에 타겟 비콘을 지정한다.
 * @param {string} targetBeaconId - 서버 beacons API 응답의 targetBeaconId 그대로 사용 (예: BUS_35_001)
 */
export async function setTargetBeacon(targetBeaconId) {
  const payload = JSON.stringify({
    cmd: 'SET_TARGET_BEACON',
    target: targetBeaconId,
  });

  await writeCommand(CANE_DEVICE_NAME, payload);
}

/** 지팡이에 비콘 스캔 시작을 명령한다. */
export async function startBeaconScan() {
  const payload = JSON.stringify({
    cmd: 'START_BEACON_SCAN',
  });

  await writeCommand(CANE_DEVICE_NAME, payload);
}

/** 지팡이에 비콘 스캔 중지를 명령한다. */
export function stopBeaconScan() {
  return runStopBeaconScanSingleFlight(() => {
    const payload = JSON.stringify({
      cmd: 'STOP_BEACON_SCAN',
    });

    return writeCommand(CANE_DEVICE_NAME, payload);
  });
}

/**
 * 지팡이가 판정한 버스 접근 상태(Notify)를 구독한다.
 * 정민님 확인(2026-08-24): 지팡이가 APPROACHING/ARRIVED/PASSING/PASSED_STOPPED/LEAVING 상태와
 * 원시 RSSI 값을 함께 Notify로 보낸다. 탑승 자동 판정(AUTO_DETECTED)에 쓸 구체적인 조건(임계값,
 * 지속 시간)은 아직 실측 전이라 미정 — 이 함수는 상태·RSSI를 그대로 전달만 하고,
 * 판정 로직은 호출부(추후 구현)에서 담당한다.
 * @param {(state: { state: string, rssi: number }) => void} onState
 * @returns {() => void} 구독 해제 함수
 */
export function subscribeCaneState(onState) {
  const device = connectedDevices.get(CANE_DEVICE_NAME);

  if (!device) {
    throw new Error('BLE_NOT_CONNECTED: 지팡이에 연결되어 있지 않습니다.');
  }

  const subscription = device.monitorCharacteristicForService(
    SERVICE_UUID,
    CHARACTERISTIC_UUID,
    (error, characteristic) => {
      if (error) {
        console.log('지팡이 상태 Notify 오류:', error);
        return;
      }

      if (!characteristic?.value) return;

      try {
        const jsonString = Buffer.from(
          characteristic.value,
          'base64',
        ).toString('utf-8');

        const parsed = JSON.parse(jsonString);
        onState(parsed);
      } catch (parseError) {
        console.log('지팡이 상태 파싱 실패:', parseError);
      }
    },
  );

  return () => subscription.remove();
}

// ── 하차벨 명령 ──────────────────────────────

/** 하차벨에 STOP_REQUEST를 전송한다. */
export async function sendStopRequest() {
  const deviceName = connectedBellDeviceName ?? bellDeviceName;
  await writeCommand(deviceName, 'STOP_REQUEST');
}

/**
 * 하차벨의 처리 결과(Notify)를 구독한다.
 * @param {(result: { result: 'SUCCESS' | 'FAIL' }) => void} onResult
 * @returns {() => void} 구독 해제 함수
 */
export function subscribeBellResult(onResult) {
  const deviceName = connectedBellDeviceName ?? bellDeviceName;
  const device = connectedDevices.get(deviceName);

  if (!device) {
    throw new Error('BLE_NOT_CONNECTED: 하차벨에 연결되어 있지 않습니다.');
  }

  const subscription = device.monitorCharacteristicForService(
    SERVICE_UUID,
    CHARACTERISTIC_UUID,
    (error, characteristic) => {
      if (error) {
        console.log('하차벨 Notify 오류:', error);
        return;
      }

      if (!characteristic?.value) return;

      try {
        const jsonString = Buffer.from(
          characteristic.value,
          'base64',
        ).toString('utf-8');

        const parsed = JSON.parse(jsonString);
        onResult(parsed);
      } catch (parseError) {
        console.log('하차벨 결과 파싱 실패:', parseError);
      }
    },
  );

  return () => subscription.remove();
}

/** 지정한 기기 연결을 해제한다. */
export async function disconnect(deviceName) {
  const device = connectedDevices.get(deviceName);

  // 동일 보드의 새 연결은 아래 해제가 끝난 뒤 진행한다.
  if (connectedBellDeviceName === deviceName) {
    connectedBellDeviceName = null;
  }
  if (!device) return pendingDisconnects.get(deviceName);
  const pending = device.cancelConnection();
  pendingDisconnects.set(deviceName, pending);
  try {
    await pending;
    if (connectedDevices.get(deviceName) === device) connectedDevices.delete(deviceName);
  } finally {
    if (pendingDisconnects.get(deviceName) === pending) pendingDisconnects.delete(deviceName);
  }
}

/**
 * 스마트지팡이 연결을 끊는다. 탑승이 확정된 뒤에 쓴다.
 *
 * 승차 안내(버스 접근 진동)가 끝나면 지팡이를 붙들고 있을 이유가 없다. 하차 안내는
 * 하차벨 보드가 맡으므로 여기서 지팡이만 놓아준다.
 *
 * 반드시 비콘 스캔을 멈춘 뒤에 호출한다. 스캔 중지는 지팡이에 명령을 써서
 * 동작하므로(writeCommand), 연결을 먼저 끊으면 중지 명령이 전달되지 않아 지팡이가
 * 탑승 뒤에도 계속 진동한다. 순서 보장은 ble/cane-release-controller.ts 가 한다.
 *
 * CANE_DEVICE_NAME 을 밖으로 내보내지 않는 이유는, 이름을 아는 곳이 늘어나면
 * 오타 하나로 다른 장치를 끊게 되기 때문이다.
 */
export async function disconnectCane() {
  await disconnect(CANE_DEVICE_NAME);
}

/** 화면 blur가 아니라 운행 취소/교체 때만 호출한다. 소유 운행의 대상만 정리한다. */
export async function disconnectBellsForTrip(tripId) {
  const cleanups = [];
  for (const [targetBeaconId, owner] of bellOwners) {
    if (owner !== tripId) continue;
    bellOwners.delete(targetBeaconId);
    if (activeConnect?.deviceName === targetBeaconId) {
      activeConnect.cancel();
      activeConnect = null;
    }
    for (let i = connectQueue.length - 1; i >= 0; i--) {
      if (connectQueue[i].deviceName === targetBeaconId) {
        connectQueue.splice(i, 1)[0].resolve(null);
      }
    }
    const device = connectedDevices.get(targetBeaconId);
    if (device) {
      connectedDevices.delete(targetBeaconId);
      if (connectedBellDeviceName === targetBeaconId) connectedBellDeviceName = null;
      // 재시도도 캡처한 A 장치만 사용한다. 같은 보드의 B 연결은 정리 완료를 기다린다.
      const pending = disconnectBellWithRetry({
        disconnectBell: () => device.cancelConnection(),
        onGaveUp: (error) => console.log('[BLE] 종료 운행 하차벨 해제 실패:', error),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }).finally(() => {
        if (pendingDisconnects.get(targetBeaconId) === pending) pendingDisconnects.delete(targetBeaconId);
      });
      pendingDisconnects.set(targetBeaconId, pending);
      cleanups.push(pending);
    }
  }
  pumpConnectQueue();
  await Promise.all(cleanups);
}
