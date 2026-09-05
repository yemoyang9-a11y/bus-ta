import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createSingleFlight } from '../../../mobile/src/ble/single-flight.js';
import { disconnectBellWithRetry } from '../../../mobile/src/ble/bell-connect-controller.js';

test('BLE 테스트 화면의 시연 대상 문자열은 한 곳에서만 정의한다', () => {
  const source = readFileSync(new URL('../../../mobile/src/screens/BleTestScreen.js', import.meta.url), 'utf8');
  assert.equal(source.match(/BUS_35_001/g)?.length, 1);
  assert.match(source, /const TEST_TARGET_BEACON_ID = 'BUS_35_001'/);
  assert.match(source, /setTargetBeacon\(TEST_TARGET_BEACON_ID\)/);
});

// 실제 bleManager 소스를 실행하고 native BLE 경계만 대체한다.
function setup(autoScan = true) {
  const calls = { scans: 0, stops: 0, overlaps: 0, connects: [] as string[], writes: [] as string[], monitors: [] as string[] };
  let scanning = false;
  const scanCallbacks: Array<(error: any, device: any) => void> = [];
  const devices = new Map<string, any>();
  function device(name: string) {
    const value = {
      name, alive: true, cancels: 0, rejectCancel: false,
      isConnected: async () => value.alive,
      connect: async () => { calls.connects.push(name); value.alive = true; return value; },
      discoverAllServicesAndCharacteristics: async () => {},
      onDisconnected: () => {},
      cancelConnection: async () => {
        value.cancels++;
        if (value.rejectCancel) throw new Error('out of range');
        value.alive = false;
      },
      writeCharacteristicWithResponseForService: async () => { calls.writes.push(name); },
      monitorCharacteristicForService: () => {
        calls.monitors.push(name);
        return { remove() {} };
      },
    };
    devices.set(name, value);
    return value;
  }
  class BleManager {
    stopDeviceScan() { calls.stops++; scanning = false; }
    startDeviceScan(_services: unknown, _options: unknown, callback: (error: null, device: any) => void) {
      calls.scans++;
      if (scanning) calls.overlaps++;
      scanning = true;
      scanCallbacks.push(callback);
      if (autoScan) for (const value of devices.values()) callback(null, value);
    }
  }
  const source = readFileSync(new URL('../../../mobile/src/ble/bleManager.js', import.meta.url), 'utf8');
  const exports: any = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, setTimeout, clearTimeout, console,
    require: (name: string) => {
      if (name === 'react-native-ble-plx') return { BleManager };
      if (name === 'buffer') return { Buffer };
      if (name === './single-flight') return { createSingleFlight };
      if (name === './bell-connect-controller') return { disconnectBellWithRetry };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return { ble: exports, calls, device, scanCallbacks, isScanning: () => scanning };
}

test('같은 bell의 실제 연결이 살아 있으면 scan/connect 없이 재사용한다', async () => {
  const { ble, calls, device } = setup();
  const bell = device('BUS_A');
  assert.equal(await ble.connectBell('BUS_A'), bell);
  assert.equal(await ble.connectBell('BUS_A'), bell);
  assert.equal(calls.scans, 1);
  assert.deepEqual(calls.connects, ['BUS_A']);
  assert.equal(ble.getBellDeviceName(), 'BUS_A');
});

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('bell 스캔 중 cane 요청은 즉시 양보받고 같은 cane 요청은 하나의 스캔을 공유한다', async () => {
  const { ble, calls, device, scanCallbacks, isScanning } = setup(false);
  const bell = ble.connectBell('BUS_A');
  await flush();
  assert.equal(calls.scans, 1);
  const cane = ble.connectCane();
  const duplicate = ble.connectCane();
  await flush();
  assert.equal(calls.scans, 2);
  assert.equal(calls.overlaps, 0);
  scanCallbacks[0]!(new Error('late scan error'), null);
  assert.equal(isScanning(), true);
  const peripheral = device('White_cane');
  scanCallbacks[1]!(null, peripheral);
  assert.equal(await cane, peripheral);
  assert.equal(await duplicate, peripheral);
  assert.equal(await bell, null);
});

test('bell native connect/cancel이 pending이어도 cane은 시작하고 늦은 bell 성공을 정리한다', async () => {
  const { ble, calls, device, scanCallbacks, isScanning } = setup(false);
  const bellDevice = device('BUS_A');
  const native = deferred<any>();
  const cancellation = deferred<void>();
  bellDevice.connect = () => native.promise;
  bellDevice.cancelConnection = async () => { bellDevice.cancels++; await cancellation.promise; };
  const bell = ble.connectBell('BUS_A');
  await flush();
  scanCallbacks[0]!(null, bellDevice);
  const cane = ble.connectCane();
  await flush();
  assert.equal(calls.scans, 2);
  assert.equal(bellDevice.cancels, 1);
  const sameBell = ble.connectBell('BUS_A');
  await flush();
  assert.equal(calls.scans, 2); // 정리가 끝날 때까지 같은 보드 single-flight 유지
  native.resolve(bellDevice);
  cancellation.resolve();
  await flush();
  assert.equal(await bell, null);
  assert.equal(await sameBell, null);
  assert.equal(bellDevice.cancels, 2);
  assert.equal(isScanning(), true); // 늦은 bell 완료는 cane 스캔을 멈추지 않는다
  const peripheral = device('White_cane');
  scanCallbacks[1]!(null, peripheral);
  assert.equal(await cane, peripheral);
  assert.equal(calls.overlaps, 0);
});

test('운행 A 해제가 늦거나 실패해도 다른 운행 B 연결과 기록은 보존한다', async () => {
  const { ble, device } = setup();
  const a = device('BUS_A');
  await ble.connectBell('BUS_A', 'trip-A');
  const pending = deferred<void>();
  a.cancelConnection = async () => { a.cancels++; await pending.promise; throw new Error('disconnect failed'); };
  const cleanup = ble.disconnectBellsForTrip('trip-A');
  const b = device('BUS_B');
  assert.equal(await ble.connectBell('BUS_B', 'trip-B'), b);
  pending.resolve();
  await cleanup;
  await ble.disconnectBellsForTrip('trip-A');
  assert.equal(a.cancels, 2);
  assert.equal(b.cancels, 0);
  assert.equal(ble.getBellDeviceName(), 'BUS_B');
});

test('같은 보드를 새 운행이 인수하면 이전 운행 정리가 B 연결을 끊지 않는다', async () => {
  const { ble, device } = setup();
  const shared = device('BUS_SHARED');
  await ble.connectBell('BUS_SHARED', 'trip-A');
  await ble.connectBell('BUS_SHARED', 'trip-B');
  await ble.disconnectBellsForTrip('trip-A');
  assert.equal(shared.cancels, 0);
  assert.equal(await ble.isBellConnected(), true);
  await ble.disconnectBellsForTrip('trip-B');
  assert.equal(shared.cancels, 1);
});

test('A의 동일 보드 해제 완료 뒤 B를 연결하고 늦은 정리가 새 캐시를 지우지 않는다', async () => {
  const { ble, calls, device } = setup();
  const old = device('BUS_SHARED');
  await ble.connectBell('BUS_SHARED', 'trip-A');
  const pending = deferred<void>();
  old.cancelConnection = async () => { old.cancels++; await pending.promise; };
  const cleanup = ble.disconnectBellsForTrip('trip-A');
  const fresh = device('BUS_SHARED');
  const next = ble.connectBell('BUS_SHARED', 'trip-B');
  await flush();
  assert.equal(calls.scans, 1);
  pending.resolve();
  await cleanup;
  assert.equal(await next, fresh);
  await ble.disconnectBellsForTrip('trip-A');
  assert.equal(await ble.isBellConnected(), true);
  assert.equal(fresh.cancels, 0);
});

test('취소된 운행의 pending native 연결이 늦게 성공해도 현재 bell로 채택하지 않는다', async () => {
  const { ble, device, scanCallbacks } = setup(false);
  const old = device('BUS_A');
  const pending = deferred<any>();
  old.connect = () => pending.promise;
  const connecting = ble.connectBell('BUS_A', 'trip-A');
  await flush();
  scanCallbacks[0]!(null, old);
  await ble.disconnectBellsForTrip('trip-A');
  pending.resolve(old);
  assert.equal(await connecting, null);
  assert.equal(await ble.isBellConnected(), false);
  assert.equal(old.cancels, 2);
});

test('P0의 8초 native attempt timeout과 late-success 정리를 보존한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ble, device, scanCallbacks } = setup(false);
  const old = device('BUS_A');
  const pending = deferred<any>();
  old.connect = () => pending.promise;
  const connecting = ble.connectBell('BUS_A');
  await flush();
  scanCallbacks[0]!(null, old);
  t.mock.timers.tick(8000);
  await flush();
  assert.equal(await connecting, null);
  assert.equal(old.cancels, 1);
  pending.resolve(old);
  await flush();
  assert.equal(old.cancels, 2);
  assert.equal(await ble.isBellConnected(), false);
});

test('connectAll은 캡처한 대상을 반환하고 더 최신 bell 대상 기록을 덮지 않는다', async () => {
  const { ble, device, scanCallbacks } = setup(false);
  const all = ble.connectAll(); // 기본 대상 BUS_35_001 캡처
  const newer = ble.connectBell('BUS_NEW');
  await flush();
  scanCallbacks[0]!(null, device('White_cane'));
  await flush();
  scanCallbacks[1]!(null, device('BUS_NEW'));
  await newer;
  await flush();
  scanCallbacks[2]!(null, device('BUS_35_001'));
  const found = await all;
  assert.equal(found.has('BUS_35_001'), true);
  assert.equal(found.has('BUS_NEW'), false);
  assert.equal(ble.getBellDeviceName(), 'BUS_NEW');
});

test('stale cached bell은 정리 후 새 scan/connect를 수행한다', async () => {
  const { ble, calls, device } = setup();
  const stale = device('BUS_A');
  await ble.connectBell('BUS_A');
  stale.alive = false;
  stale.rejectCancel = true;
  const fresh = device('BUS_A');
  assert.equal(await ble.connectBell('BUS_A'), fresh);
  assert.equal(stale.cancels, 1);
  assert.equal(calls.scans, 2);
  assert.equal(await ble.isBellConnected(), true);
});

test('이전 disconnect reject 후에도 새 bell에 연결하고 명령/구독 대상을 갱신한다', async () => {
  const { ble, calls, device } = setup();
  const old = device('BUS_A');
  await ble.connectBell('BUS_A');
  old.rejectCancel = true;
  const next = device('BUS_B');
  assert.equal(await ble.connectBell('BUS_B'), next);
  assert.equal(old.cancels, 1);
  assert.deepEqual(calls.connects, ['BUS_A', 'BUS_B']);
  assert.equal(ble.getBellDeviceName(), 'BUS_B');
  await ble.sendStopRequest();
  ble.subscribeBellResult(() => {})();
  assert.deepEqual(calls.writes, ['BUS_B']);
  assert.deepEqual(calls.monitors, ['BUS_B']);
  assert.equal(await ble.connectBell('BUS_B'), next);
  assert.equal(calls.scans, 2);
});
