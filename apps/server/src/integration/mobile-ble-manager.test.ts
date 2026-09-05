import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createSingleFlight } from '../../../mobile/src/ble/single-flight.js';

// 실제 bleManager 소스를 실행하고 native BLE 경계만 대체한다.
function setup() {
  const calls = { scans: 0, connects: [] as string[], writes: [] as string[], monitors: [] as string[] };
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
    stopDeviceScan() {}
    startDeviceScan(_services: unknown, _options: unknown, callback: (error: null, device: any) => void) {
      calls.scans++;
      for (const value of devices.values()) callback(null, value);
    }
  }
  const source = readFileSync(new URL('../../../mobile/src/ble/bleManager.js', import.meta.url), 'utf8');
  const exports: any = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, setTimeout, clearTimeout, console,
    require: (name: string) => {
      if (name === 'react-native-ble-plx') return { BleManager };
      if (name === 'buffer') return { Buffer };
      if (name === './single-flight') return { createSingleFlight };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return { ble: exports, calls, device };
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
