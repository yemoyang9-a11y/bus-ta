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

// 찾을 비콘 (앱이 SET_TARGET_BEACON으로 바꿀 수 있음, 기본값은 테스트용)
String targetBeacon = "BUS_1551_001";

// 스캔 상태 (START/STOP으로 제어)
bool scanning = false;

BLEScan *pBLEScan;
BLECharacteristic *pCharacteristic;

// ===== RSSI 기록용 =====
const int HISTORY_SIZE = 6;
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

int stableCount = 0;       // 안정적으로 유지된 횟수 (정차 판정용)
bool passedPeak = false;   // 피크 후 급락이 있었는지 (지나감 기억)

// ===== RSSI 기록 추가 =====
void addRSSI(int rssi) {
  if (historyCount < HISTORY_SIZE) {
    rssiHistory[historyCount++] = rssi;
  } else {
    for (int i = 0; i < HISTORY_SIZE - 1; i++) rssiHistory[i] = rssiHistory[i + 1];
    rssiHistory[HISTORY_SIZE - 1] = rssi;
  }
}

// ===== 상태 판정 =====
BusState judgeState() {
  if (historyCount < 3) return STATE_APPROACHING;

  int latest = rssiHistory[historyCount - 1];
  int prev   = rssiHistory[historyCount - 2];
  int oldest = rssiHistory[0];

  // 1. 피크 후 급락 감지 → "지나감" 기억
  if (prev - latest >= 10) {
    passedPeak = true;   // 방금 급락했다 = 지나가는 중
    stableCount = 0;
    return STATE_PASSING;
  }

  // 2. 값이 안정적으로 유지되는지 (정차 후보)
  if (abs(latest - prev) <= 3 && abs(latest - oldest) <= 5) {
    stableCount++;
    if (stableCount >= 4) {
      // 안정적으로 유지됨 = 정차. 근데 지나갔었나?
      if (passedPeak) {
        return STATE_PASSED_STOPPED;  // 지나가서 다른 곳 정차
      } else {
        return STATE_ARRIVED;         // 다가와서 앞에 정차
      }
    }
  } else {
    stableCount = 0;
  }

  // 3. 계속 강해지는 중 → 접근
  if (latest > oldest + 2) {
    passedPeak = false;  // 다시 다가오면 지나감 기억 리셋
    return STATE_APPROACHING;
  }

  // 4. 계속 약해지는 중 → 멀어짐
  if (latest < oldest - 3) {
    return STATE_LEAVING;
  }

  return currentState;  // 변화 없으면 유지
}

// ===== 진동 (패턴 없이 세기/촘촘함으로 자연스럽게) =====
void vibrateByState(BusState state, int rssi) {
  switch (state) {
    case STATE_APPROACHING: {
      // 거리 가까울수록 촘촘하게 (부드러운 유도)
      Serial.print("[상태] 접근 중 (RSSI "); Serial.print(rssi); Serial.println(")");
      int onTime, offTime;
      if (rssi >= -60)      { onTime = 200; offTime = 60;  }  // 가까움: 촘촘
      else if (rssi >= -70) { onTime = 150; offTime = 180; }  // 중간
      else                  { onTime = 100; offTime = 350; }  // 멀음: 띄엄
      digitalWrite(MOTOR_PIN, HIGH); delay(onTime);
      digitalWrite(MOTOR_PIN, LOW);  delay(offTime);
      break;
    }
    case STATE_ARRIVED:
      // 다가와서 앞 정차: 강하게 지속
      Serial.println("[상태] 정차 (탈 수 있음)");
      digitalWrite(MOTOR_PIN, HIGH); delay(400);
      digitalWrite(MOTOR_PIN, LOW);  delay(100);
      break;

    case STATE_PASSED_STOPPED:
      // 지나가서 다른 곳 정차: 중간 세기 (이동 필요 신호)
      Serial.println("[상태] 지나가서 정차 (이동 필요)");
      digitalWrite(MOTOR_PIN, HIGH); delay(200);
      digitalWrite(MOTOR_PIN, LOW);  delay(300);
      break;

    case STATE_PASSING:
      Serial.println("[상태] 통과 중 (진동 억제)");
      digitalWrite(MOTOR_PIN, LOW);
      break;

    case STATE_LEAVING:
      Serial.println("[상태] 멀어지는 중");
      digitalWrite(MOTOR_PIN, LOW);
      break;

    default:
      digitalWrite(MOTOR_PIN, LOW);
      break;
  }
}

// ===== 스캔 상태 초기화 =====
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

    // 간단 파싱 (JSON 라이브러리 없이 문자열 검색)
    if (value.indexOf("SET_TARGET_BEACON") >= 0) {
      // "target":"..." 값 추출
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

  // BLE 초기화 (서버 + 스캐너 둘 다)
  BLEDevice::init(DEVICE_NAME);

  // --- BLE 서버 (앱 명령 수신용) ---
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

  // --- BLE 스캐너 (비콘 감지용) ---
  pBLEScan = BLEDevice::getScan();
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);

  if (TEST_MODE) {
    scanning = true;
    Serial.println("[TEST_MODE] 앱 명령 없이 자동 스캔 시작");
    Serial.print("[설정] 타겟 비콘 = ");
    Serial.println(targetBeacon);
  } else {
    Serial.println("[대기] 앱의 START_BEACON_SCAN 명령 대기 중");
  }
}

void loop() {
  if (!scanning) {
    delay(200);   // 스캔 꺼져 있으면 대기
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
      currentState = judgeState();
      vibrateByState(currentState, rssi);
    }
  }

  if (!found) {
    notFoundCount++;
    digitalWrite(MOTOR_PIN, LOW);
    if (notFoundCount >= 3) {
      Serial.println("[상태] 비콘 사라짐 → 초기화");
      resetScanData();
    }
  }

  pBLEScan->clearResults();
}
