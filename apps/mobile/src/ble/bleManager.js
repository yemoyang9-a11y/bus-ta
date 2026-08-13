import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

// 정민님 확인(2026-08-04): 공통 UUID, 기기 2대(지팡이/하차벨) 각각 연결
const SERVICE_UUID = '4fa45540-8201-11e5-8223-0002a5d5c51b';
const CHARACTERISTIC_UUID = '4fa45541-8201-11e5-8223-0002a5d5c51b';

const CANE_DEVICE_NAME = 'White_cane';
// 정민님 확정(2026-08-12): 이 보드가 버스 비콘+하차벨 겸용이라 이름 하나로 둘 다 처리(MOCK 제거)
const BELL_DEVICE_NAME = 'BUS_1551_001';

const manager = new BleManager();

// 연결된 기기를 device name별로 보관
const connectedDevices = new Map();

/**
 * 여러 개의 device name을 한 번의 스캔으로 동시에 찾아서 연결한다.
 * (예모님 코멘트 3번, 2026-08-13 반영)
 * BleManager 인스턴스가 하나뿐이라 startDeviceScan을 두 번 부르면 서로의
 * stopDeviceScan()이 충돌하던 문제를, 스캔 자체를 한 번만 실행하는 방식으로 해결한다.
 *
 * @param {string[]} deviceNames - 찾을 기기 이름 목록
 * @returns {Promise<Map<string, import('react-native-ble-plx').Device>>} 이름별 연결 결과
 *   연결 성공한 기기만 담기고, 실패(타임아웃 등)한 기기는 결과에서 빠진다.
 */
function connectByNames(deviceNames) {
  return new Promise((resolve) => {
    const remaining = new Set(deviceNames);
    const found = new Map();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      manager.stopDeviceScan();
      resolve(found);
    };

    const timeout = setTimeout(finish, 10000);

    manager.startDeviceScan([SERVICE_UUID], null, async (error, device) => {
      if (error) {
        finish();
        return;
      }

      if (device?.name && remaining.has(device.name)) {
        remaining.delete(device.name);

        try {
          const connected = await device.connect();
          await connected.discoverAllServicesAndCharacteristics();
          connectedDevices.set(device.name, connected);
          found.set(device.name, connected);
        } catch {
          // 연결 실패한 기기는 found에 담지 않는다. 호출부가 개별 처리.
        }

        if (remaining.size === 0) {
          finish();
        }
      }
    });
  });
}

/**
 * 지팡이·하차벨을 한 번의 스캔으로 동시에 연결한다.
 * 각 기기별 성공/실패 여부를 개별적으로 반환하므로, 호출부는 필요한 기기가
 * 연결됐는지 결과 Map으로 확인해야 한다.
 */
export async function connectAll() {
  return connectByNames([CANE_DEVICE_NAME, BELL_DEVICE_NAME]);
}

/** 스마트지팡이(White_cane) 연결 여부를 확인한다. */
export function isCaneConnected() {
  return connectedDevices.has(CANE_DEVICE_NAME);
}

/** 하차벨(BUS_1551_001, 버스 비콘 겸용) 연결 여부를 확인한다. */
export function isBellConnected() {
  return connectedDevices.has(BELL_DEVICE_NAME);
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
 * @param {string} targetBeaconId - 서버 beacons API 응답의 targetBeaconId 그대로 사용 (예: BUS_1551_001)
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
export async function stopBeaconScan() {
  const payload = JSON.stringify({ cmd: 'STOP_BEACON_SCAN' });
  await writeCommand(CANE_DEVICE_NAME, payload);
}

// ── 하차벨 명령 ──────────────────────────────

/** 하차벨에 STOP_REQUEST를 전송한다. */
export async function sendStopRequest() {
  await writeCommand(BELL_DEVICE_NAME, 'STOP_REQUEST');
}

/**
 * 하차벨의 처리 결과(Notify)를 구독한다.
 * @param {(result: { result: 'SUCCESS' | 'FAIL' }) => void} onResult
 * @returns {() => void} 구독 해제 함수
 */
export function subscribeBellResult(onResult) {
  const device = connectedDevices.get(BELL_DEVICE_NAME);
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