/*
 * 스마트 지팡이 (White_cane) - ESP32
 *
 * [역할]
 *  - BLE 스캔: 버스 비콘(BUS_1551_001)을 스캔해서 RSSI로 거리·상태 판정
 *  - 진동 안내: 상태에 따라 진동모터(GPIO25) 제어
 *  - 앱 명령 수신: SET_TARGET_BEACON / START_BEACON_SCAN / STOP_BEACON_SCAN
 *  - 상태 전송: 판정한 상태(APPROACHING/ARRIVED 등)를 앱에 Notify로 전송
 *
 * [BLE]
 *  - device name: White_cane
 *  - Service/Characteristic UUID: 하차벨과 동일 (앱은 device name으로 구분)
 *  - 명령 수신(Write): JSON {"cmd":"...","target":"..."}
 *  - 상태 전송(Notify): JSON {"state":"...","rssi":...}
 *
 * [상태 판정] RSSI 평균+추세 기반: APPROACHING/ARRIVED/PASSING/PASSED_STOPPED/LEAVING
 * ※ 판정 기준값은 실환경 거리 테스트로 조정 예정 (현재 근접 테스트 기준)
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>

// ===== 설정 =====
#define SERVICE_UUID        "4fa45540-8201-11e5-8223-0002a5d5c51b"
#define CHARACTERISTIC_UUID "4fa45541-8201-11e5-8223-0002a5d5c51b"
#define DEVICE_NAME         "White_cane"

#define TEST_MODE false   // true: 앱 명령 없이 부팅 시 자동 스캔 (테스트용)
                          // false: 앱이 START_BEACON_SCAN 보내야 시작 (실제 동작)

const int MOTOR_PIN = 25;

// 찾을 비콘 (앱이 SET_TARGET_BEACON으로 변경, 기본값은 테스트용)
String targetBeacon = "BUS_1551_001";

bool scanning = false;

BLEScan *pBLEScan;
BLECharacteristic *pCharacteristic;

// ===== RSSI 기록용 =====
const int HISTORY_SIZE = 10;
int rssiHistory[HISTORY_SIZE];
int historyCount = 0;
int notFoundCount = 0;

// ===== 상태 정의 =====
enum BusState {
  STATE_NONE,
  STATE_APPROACHING,    // 다가오는 중
  STATE_ARRIVED,        // 다가와서 앞에 정차 (탈 수 있음)
  STATE_PASSING,        // 지나가는 중
  STATE_PASSED_STOPPED, // 지나가서 다른 곳 정차 (이동 필요)
  STATE_LEAVING         // 멀어짐
};
BusState currentState = STATE_NONE;

int stableCount = 0;
bool passedPeak = false;

// ===== RSSI 기록 추가 =====
void addRSSI(int rssi) {
  if (historyCount < HISTORY_SIZE) {
    rssiHistory[historyCount++] = rssi;
  } else {
    for (int i = 0; i < HISTORY_SIZE - 1; i++) rssiHistory[i] = rssiHistory[i + 1];
    rssiHistory[HISTORY_SIZE - 1] = rssi;
  }
}

// ===== 최근 평균 (노이즈 완화) =====
int getAverageRSSI() {
  if (historyCount == 0) return -100;
  int sum = 0;
  int n = min(historyCount, HISTORY_SIZE);
  for (int i = 0; i < n; i++) sum += rssiHistory[i];
  return sum / n;
}

// ===== 추세 (최근 절반 - 이전 절반 평균) =====
int getTrend() {
  if (historyCount < 4) return 0;
  int n = min(historyCount, HISTORY_SIZE);
  int half = n / 2;
  int recentSum = 0, olderSum = 0;
  for (int i = 0; i < half; i++) olderSum += rssiHistory[i];
  for (int i = n - half; i < n; i++) recentSum += rssiHistory[i];
  return (recentSum / half) - (olderSum / half);
}

// ===== 상태 판정 =====
BusState judgeState() {
  if (historyCount < 6) return STATE_NONE;

  int trend = getTrend();

  // 1. 큰 급락 → 통과
  if (trend <= -20) {
    passedPeak = true;
    stableCount = 0;
    return STATE_PASSING;
  }

  // 2. 안정 + 충분히 가까움 → 정차
  if (abs(trend) <= 6 && getAverageRSSI() >= -68) {
    stableCount++;
    if (stableCount >= 3) {
      if (passedPeak) return STATE_PASSED_STOPPED;
      else return STATE_ARRIVED;
    }
    return currentState;
  } else {
    stableCount = 0;
  }

  // 3. 뚜렷하게 강해짐 → 접근
  if (trend >= 8) {
    passedPeak = false;
    return STATE_APPROACHING;
  }

  // 4. 뚜렷하게 약해짐 → 멀어짐
  if (trend <= -8) {
    return STATE_LEAVING;
  }

  return currentState;
}

// ===== 상태 → 영문 코드 (앱 전송용) =====
const char* stateToCode(BusState s) {
  switch (s) {
    case STATE_APPROACHING:    return "APPROACHING";
    case STATE_ARRIVED:        return "ARRIVED";
    case STATE_PASSING:        return "PASSING";
    case STATE_PASSED_STOPPED: return "PASSED_STOPPED";
    case STATE_LEAVING:        return "LEAVING";
    default:                   return "NONE";
  }
}

// ===== 상태를 앱에 Notify 전송 =====
void notifyState(BusState state, int avgRssi) {
  if (pCharacteristic == NULL) return;
  String json = "{\"state\":\"";
  json += stateToCode(state);
  json += "\",\"rssi\":";
  json += String(avgRssi);
  json += "}";
  pCharacteristic->setValue(json.c_str());
  pCharacteristic->notify();
  Serial.print("[BLE→앱] 상태 전송: ");
  Serial.println(json);
}

// ===== 진동 (세기/촘촘함으로 자연스럽게) =====
void vibrateByState(BusState state, int avgRssi) {
  switch (state) {
    case STATE_APPROACHING: {
      int onTime, offTime;
      if (avgRssi >= -60)      { onTime = 200; offTime = 60;  }
      else if (avgRssi >= -70) { onTime = 150; offTime = 180; }
      else                     { onTime = 100; offTime = 350; }
      digitalWrite(MOTOR_PIN, HIGH); delay(onTime);
      digitalWrite(MOTOR_PIN, LOW);  delay(offTime);
      break;
    }
    case STATE_ARRIVED:
      digitalWrite(MOTOR_PIN, HIGH); delay(400);
      digitalWrite(MOTOR_PIN, LOW);  delay(100);
      break;

    case STATE_PASSED_STOPPED:
      digitalWrite(MOTOR_PIN, HIGH); delay(200);
      digitalWrite(MOTOR_PIN, LOW);  delay(300);
      break;

    case STATE_PASSING:
    case STATE_LEAVING:
    default:
      digitalWrite(MOTOR_PIN, LOW);
      break;
  }
}

// ===== 스캔 데이터 초기화 =====
void resetScanData() {
  historyCount = 0;
  stableCount = 0;
  notFoundCount = 0;
  passedPeak = false;
  currentState = STATE_NONE;
}

// ===== BLE 명령 수신 콜백 =====
class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    String value = pChar->getValue();
    if (value.length() == 0) return;

    Serial.print("[BLE] 명령 수신: ");
    Serial.println(value);

    if (value.indexOf("SET_TARGET_BEACON") >= 0) {
      int ti = value.indexOf("\"target\"");
      if (ti >= 0) {
        int c1 = value.indexOf(':', ti);
        int q1 = value.indexOf('"', c1);
        int q2 = value.indexOf('"', q1 + 1);
        if (q1 >= 0 && q2 > q1) {
          targetBeacon = value.substring(q1 + 1, q2);
          Serial.print("[설정] 타겟 비콘 = ");
          Serial.println(targetBeacon);
        }
      }
    }
    else if (value.indexOf("START_BEACON_SCAN") >= 0) {
      scanning = true;
      resetScanData();
      Serial.println("[제어] 스캔 시작");
    }
    else if (value.indexOf("STOP_BEACON_SCAN") >= 0) {
      scanning = false;
      digitalWrite(MOTOR_PIN, LOW);
      Serial.println("[제어] 스캔 중지");
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n===== 지팡이 (White_cane) 시작 =====");

  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);

  BLEDevice::init(DEVICE_NAME);

  // --- BLE 서버 (앱 명령 수신 + 상태 전송) ---
  BLEServer *pServer = BLEDevice::createServer();
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new CommandCallbacks());
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("[BLE] 서버 광고 시작 (앱 연결 대기)");

  // --- BLE 스캐너 (비콘 감지) ---
  pBLEScan = BLEDevice::getScan();
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);

  if (TEST_MODE) {
    scanning = true;
    Serial.println("[TEST_MODE] 자동 스캔 시작");
  } else {
    Serial.println("[대기] 앱의 START_BEACON_SCAN 명령 대기 중");
  }
}

void loop() {
  if (!scanning) {
    delay(200);
    return;
  }

  BLEScanResults *foundDevices = pBLEScan->start(1, false);
  bool found = false;
  int count = foundDevices->getCount();

  for (int i = 0; i < count; i++) {
    BLEAdvertisedDevice device = foundDevices->getDevice(i);
    String name = device.getName().c_str();
    if (name == targetBeacon) {
      found = true;
      int rssi = device.getRSSI();
      notFoundCount = 0;
      addRSSI(rssi);

      BusState newState = judgeState();
      if (newState != currentState) {          // 상태 바뀔 때만 앱에 전송
        currentState = newState;
        notifyState(currentState, getAverageRSSI());
      }
      vibrateByState(currentState, getAverageRSSI());
    }
  }

  if (!found) {
    notFoundCount++;
    digitalWrite(MOTOR_PIN, LOW);
    if (notFoundCount >= 3) {
      resetScanData();
    }
  }

  pBLEScan->clearResults();
}
