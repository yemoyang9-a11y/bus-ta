import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { createSingleFlight } from './single-flight';

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

const manager = new BleManager();

// 연결된 기기를 device name별로 보관
const connectedDevices = new Map();
const runStopBeaconScanSingleFlight = createSingleFlight();

/**
 * 한 개의 device name을 스캔해서 찾은 뒤 연결한다.
 * @param {string} deviceName
 * @returns {Promise<import('react-native-ble-plx').Device | null>} 연결 성공한 기기, 실패 시 null
 */
function scanAndConnect(deviceName) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      manager.stopDeviceScan();
      resolve(result);
    };

    const timeout = setTimeout(() => finish(null), 10000);

    manager.startDeviceScan(null, null, async (error, device) => {
      if (error) {
        console.log('[BLE] 스캔 오류:', error);
        finish(null);
        return;
      }

      if (device?.name === deviceName) {
        manager.stopDeviceScan(); // 연결 시도 중 다른 콜백이 겹치지 않도록 즉시 스캔 중단

        try {
          const connected = await device.connect();
          await connected.discoverAllServicesAndCharacteristics();
          connectedDevices.set(deviceName, connected);

          // 예모님 지적(2026-09-04): 여기서 Map 에 넣기만 하고 빼는 곳이 연결 해제
          // 함수뿐이라, 버스 안에서 연결이 끊겨도 Map 에는 그대로 남았다. 그러면
          // isBellConnected() 가 true 를 돌려주고 재연결을 건너뛰어, 정작 명령을
          // 보낼 때 실패한다. 끊기는 순간 Map 에서 지운다.
          connected.onDisconnected(() => {
            if (connectedDevices.get(deviceName) === connected) {
              connectedDevices.delete(deviceName);
              console.log('[BLE] 연결 끊김:', deviceName);
            }
          });

          finish(connected);
        } catch (connectError) {
          console.log('[BLE] 연결 실패:', deviceName, connectError);
          finish(null);
        }
      }
    });
  });
}

// 진행 중인 연결 요청. 같은 기기를 두 화면이 동시에 찾으면 스캔을 두 번 시작하지 않고
// 먼저 시작한 요청의 결과를 함께 기다린다.
const inFlightConnects = new Map();

// BleManager 인스턴스가 하나뿐이라 스캔도 하나뿐이다. 한쪽의 stopDeviceScan() 이
// 다른 쪽 스캔을 끊으므로, 서로 다른 기기라도 스캔은 한 번에 하나만 돌린다.
let connectQueue = Promise.resolve();

/**
 * 한 기기를 연결한다. 같은 이름의 요청이 이미 진행 중이면 그 결과를 함께 기다리고,
 * 다른 이름이면 앞선 스캔이 끝난 뒤에 시작한다.
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

  const pending = connectQueue.then(() => scanAndConnect(deviceName));
  connectQueue = pending.catch(() => undefined);

  const tracked = pending.finally(() => {
    if (inFlightConnects.get(deviceName) === tracked) {
      inFlightConnects.delete(deviceName);
    }
  });
  inFlightConnects.set(deviceName, tracked);
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
  return connectByNames([CANE_DEVICE_NAME, bellDeviceName]);
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
 */
export async function connectBell(targetBeaconId) {
  // 예모님 지적(2026-09-04): 이 변수는 모듈 전역이라 운행이 끝나도 남는다. 예전에는
  // targetBeaconId 가 없을 때 이전 값을 그대로 썼고, 그러면 다음 운행에서 비콘 조회가
  // 실패했을 때 이전 버스의 보드에 붙으러 갔다. 값이 없으면 이전 값이 아니라 기본값으로
  // 되돌린다.
  bellDeviceName = targetBeaconId || DEFAULT_BELL_DEVICE_NAME;
  if (!targetBeaconId) {
    console.log('[BLE] targetBeaconId 없음 - 기본 하차벨 이름 사용:', bellDeviceName);
  }
  return connectOneByName(bellDeviceName);
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
  const device = connectedDevices.get(bellDeviceName);
  if (!device) return false;

  try {
    const connected = await device.isConnected();
    if (!connected) connectedDevices.delete(bellDeviceName);
    return connected;
  } catch (error) {
    console.log('[BLE] 하차벨 연결 확인 실패:', error);
    connectedDevices.delete(bellDeviceName);
    return false;
  }
}

/** 이번 운행에서 쓰는 하차벨 보드 이름. 연결 해제나 진단에 쓴다. */
export function getBellDeviceName() {
  return bellDeviceName;
}

/**
 * 연결된 기기에 문자열 명령을 Write한다.
 * @param {string} deviceName
 * @param {string} payload - 전송할 문자열 (평문 또는 JSON 문자열)
 */
async function writeCommand(deviceName, payload) {
  const device = connectedDevices.get(deviceName);
  if (!device) {
    throw new Error(`BLE_NOT_CONNECTED: ${deviceName}에 연결되어 있지 않습니다.`);
  }

  const base64Payload = Buffer.from(payload, 'utf-8').toString('base64');
  await device.writeCharacteristicWithResponseForService(
    SERVICE_UUID,
    CHARACTERISTIC_UUID,
    base64Payload
  );
}

// ── 스마트지팡이 명령 ──────────────────────────────

/**
 * 지팡이에 타겟 비콘을 지정한다.
 * @param {string} targetBeaconId - 서버 beacons API 응답의 targetBeaconId 그대로 사용 (예: BUS_35_001)
 */
export async function setTargetBeacon(targetBeaconId) {
  const payload = JSON.stringify({ cmd: 'SET_TARGET_BEACON', target: targetBeaconId });
  await writeCommand(CANE_DEVICE_NAME, payload);
}

/** 지팡이에 비콘 스캔 시작을 명령한다. */
export async function startBeaconScan() {
  const payload = JSON.stringify({ cmd: 'START_BEACON_SCAN' });
  await writeCommand(CANE_DEVICE_NAME, payload);
}

/** 지팡이에 비콘 스캔 중지를 명령한다. */
export function stopBeaconScan() {
  return runStopBeaconScanSingleFlight(() => {
    const payload = JSON.stringify({ cmd: 'STOP_BEACON_SCAN' });
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
        const jsonString = Buffer.from(characteristic.value, 'base64').toString('utf-8');
        const parsed = JSON.parse(jsonString);
        onState(parsed);
      } catch (parseError) {
        console.log('지팡이 상태 파싱 실패:', parseError);
      }
    }
  );

  return () => subscription.remove();
}

// ── 하차벨 명령 ──────────────────────────────

/** 하차벨에 STOP_REQUEST를 전송한다. */
export async function sendStopRequest() {
  await writeCommand(bellDeviceName, 'STOP_REQUEST');
}

/**
 * 하차벨의 처리 결과(Notify)를 구독한다.
 * @param {(result: { result: 'SUCCESS' | 'FAIL' }) => void} onResult
 * @returns {() => void} 구독 해제 함수
 */
export function subscribeBellResult(onResult) {
  const device = connectedDevices.get(bellDeviceName);
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
        const jsonString = Buffer.from(characteristic.value, 'base64').toString('utf-8');
        const parsed = JSON.parse(jsonString);
        onResult(parsed);
      } catch (parseError) {
        console.log('하차벨 결과 파싱 실패:', parseError);
      }
    }
  );

  return () => subscription.remove();
}

/** 지정한 기기 연결을 해제한다. */
export async function disconnect(deviceName) {
  const device = connectedDevices.get(deviceName);
  if (device) {
    await device.cancelConnection();
    connectedDevices.delete(deviceName);
  }
}
