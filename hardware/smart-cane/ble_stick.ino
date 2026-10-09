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
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <esp_gatts_api.h>
#include <string.h>

#if !defined(CONFIG_BLUEDROID_ENABLED)
#error "This transport is validated with Arduino-ESP32 3.3.12 Bluedroid."
#endif

#include "proximity-feedback.h"

// ===== 설정 =====
#define SERVICE_UUID        "4fa45540-8201-11e5-8223-0002a5d5c51b"
#define CHARACTERISTIC_UUID "4fa45541-8201-11e5-8223-0002a5d5c51b"
#define DEVICE_NAME         "White_cane"

#define TEST_MODE false   // true: 앱 명령 없이 부팅 시 자동 스캔 (테스트용)
                          // false: 앱이 START_BEACON_SCAN 보내야 시작 (실제 동작)

const int MOTOR_PIN = 25;
const uint32_t SCAN_DURATION_SECONDS = 1;
const uint32_t MOTOR_TICK_MS = 20;
const int RESET_AFTER_MISSED_SCANS = 4;

BLEScan *pBLEScan;
BLECharacteristic *pCharacteristic;
BLE2902 *pNotifySubscription;
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;
smart_cane::ScanMailbox scanMailbox;

// Normal task mutex: command acceptance cannot interrupt a loop output
// transaction. Lock order is feedbackMutex -> stateMux, never the reverse.
// Scan callbacks use stateMux only, so BLE completion cannot wait on output.
class FeedbackMutex {
 public:
  bool begin() { handle_ = xSemaphoreCreateMutex(); return handle_ != NULL; }
  void lock() { xSemaphoreTake(handle_, portMAX_DELAY); }
  bool tryLock() { return xSemaphoreTake(handle_, 0) == pdTRUE; }
  void unlock() { xSemaphoreGive(handle_); }
 private:
  SemaphoreHandle_t handle_ = NULL;
};
FeedbackMutex feedbackMutex;
smart_cane::FeedbackTransactions<FeedbackMutex> feedbackTransactions(feedbackMutex);
// GATT metadata is owned under the same output mutex. Each new connection,
// including a reused connId, starts unsubscribed with the default ATT MTU.
smart_cane::NotificationPeers<CONFIG_BT_ACL_CONNECTIONS> notificationPeers;
esp_gatt_if_t notificationInterface = ESP_GATT_IF_NONE;

class DirectGattTransport {
 public:
  bool sendRaw(uint16_t connectionId, const uint8_t* payload, size_t length) {
    if (notificationInterface == ESP_GATT_IF_NONE || pCharacteristic == NULL) return false;
    return esp_ble_gatts_send_indicate(notificationInterface, connectionId,
        pCharacteristic->getHandle(), static_cast<uint16_t>(length),
        const_cast<uint8_t*>(payload), false) == ESP_OK;
  }
};
DirectGattTransport notificationTransport;

// Only loop() owns these objects and all trend/history fields below.
smart_cane::ProximityFeedback proximityFeedback;
smart_cane::FreshRssiNotifyGate notifyGate;
uint32_t appliedGeneration = 0;
bool scanning = false;

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
void notifyState(BusState state, int rawRssi) {
  if (pCharacteristic == NULL) return;
  const smart_cane::NotificationFrame json(stateToCode(state), rawRssi);
  // Never set/read the characteristic value for TX: the SDK also writes
  // that value before onWrite, outside our mutex. It is RX-only now.
  // ESP-IDF submits a deep copy of this local buffer before returning.
  for (size_t i = 0; i < CONFIG_BT_ACL_CONNECTIONS; ++i) {
    smart_cane::sendIndependentNotification(notificationTransport, notificationPeers.at(i),
        reinterpret_cast<const uint8_t*>(json.bytes), json.length);
  }
}

// ===== GPIO25 PWM =====
// Arduino-ESP32 3.3.12 maps analogWrite to the board's LEDC timer API.
// This full sketch/transport has not been verified on other core versions.
void writeMotorPwm(uint8_t duty) {
  analogWrite(MOTOR_PIN, duty);
}

// ===== 스캔 데이터 초기화 =====
void resetScanData() {
  historyCount = 0;
  stableCount = 0;
  notFoundCount = 0;
  passedPeak = false;
  currentState = STATE_NONE;
  notifyGate.reset();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer, esp_ble_gatts_cb_param_t *param) override {
    (void)pServer;
    feedbackTransactions.run([&]() { notificationPeers.connect(param->connect.conn_id); });
  }

  void onMtuChanged(BLEServer *pServer, esp_ble_gatts_cb_param_t *param) override {
    (void)pServer;
    feedbackTransactions.run([&]() {
      notificationPeers.setMtu(param->mtu.conn_id, param->mtu.mtu);
    });
  }

  void onDisconnect(BLEServer *pServer, esp_ble_gatts_cb_param_t *param) override {
    feedbackTransactions.run([&]() { notificationPeers.disconnect(param->disconnect.conn_id); });
    // Re-advertise from the server callback so a phone can reconnect after a
    // transient link loss without requiring a reboot or a new START command.
    pServer->startAdvertising();
  }
};

// SDK descriptor storage is shared too. Track each connection's CCCD from
// the immutable GATT event instead of reading BLE2902::getNotifications().
void handleGattMetadata(esp_gatts_cb_event_t event, esp_gatt_if_t interfaceId,
                        esp_ble_gatts_cb_param_t *param) {
  if (event == ESP_GATTS_REG_EVT && param->reg.status == ESP_GATT_OK) {
    feedbackTransactions.run([&]() { notificationInterface = interfaceId; });
    return;
  }
  if (event != ESP_GATTS_WRITE_EVT || pNotifySubscription == NULL ||
      param->write.handle != pNotifySubscription->getHandle() ||
      param->write.is_prep || param->write.offset != 0 || param->write.len != 2) return;
  const bool subscribed = (param->write.value[0] & 1u) != 0;
  feedbackTransactions.run([&]() {
    if (interfaceId == notificationInterface) {
      notificationPeers.subscribe(param->write.conn_id, subscribed);
    }
  });
}

void processScanResults(BLEScanResults results) {
  portENTER_CRITICAL(&stateMux);
  const smart_cane::ScanContext context = scanMailbox.context();
  portEXIT_CRITICAL(&stateMux);

  bool found = false;
  int strongestRssi = -100;
  const int count = results.getCount();
  for (int i = 0; i < count; i++) {
    BLEAdvertisedDevice device = results.getDevice(i);
    String name = device.getName().c_str();
    if (name != context.target) continue;

    const int rssi = device.getRSSI();
    if (!found || rssi > strongestRssi) {
      strongestRssi = rssi;
      found = true;
    }
  }

  pBLEScan->clearResults();
  // Publication and generation validation are one atomic operation. Keep
  // in-flight set until all result access/cleanup above has completed.
  portENTER_CRITICAL(&stateMux);
  scanMailbox.finish(context.generation, found, strongestRssi);
  portEXIT_CRITICAL(&stateMux);
}

void consumeScanUpdate() {
  portENTER_CRITICAL(&stateMux);
  const smart_cane::FeedbackUpdate update = scanMailbox.consume();
  portEXIT_CRITICAL(&stateMux);

  const uint32_t nowMs = millis();
  appliedGeneration = update.generation;
  scanning = update.enabled;
  if (update.reset) {
    resetScanData();
    if (scanning) proximityFeedback.start(nowMs);
    else proximityFeedback.stop(nowMs);
    writeMotorPwm(0);
  }
  if (!scanning || !update.completed) return;

  if (update.found) {
    notFoundCount = 0;
    proximityFeedback.observeSignal(nowMs, update.rssi);
    addRSSI(update.rssi);

    const BusState newState = judgeState();
    const bool stateChanged = newState != STATE_NONE && newState != currentState;
    if (newState != STATE_NONE) currentState = newState;

    // The app's boarding detector consumes raw RSSI and requires fresh
    // samples. Keep the existing state string and JSON shape, but emit at
    // least once per scan window while a target advertisement is actually
    // present. No notification is generated from a stale sample on loss.
    if (currentState != STATE_NONE &&
        notifyGate.shouldNotify(nowMs, true, stateChanged)) {
      notifyState(currentState, update.rssi);
    }
  } else {
    notFoundCount++;
    // Preserve the controller's grace/fade behavior. This reset only drops
    // stale trend history after an extended loss; it never writes the motor
    // directly or feeds a fake RSSI notification.
    if (notFoundCount >= RESET_AFTER_MISSED_SCANS) {
      resetScanData();
    }
  }
}

void startNextScanIfIdle() {
  if (pBLEScan == NULL) return;
  portENTER_CRITICAL(&stateMux);
  const bool start = scanMailbox.begin(appliedGeneration);
  const smart_cane::ScanContext context = scanMailbox.context();
  portEXIT_CRITICAL(&stateMux);
  if (!start) return;
  // Callback overload returns after starting the scan, not after one second.
  // Do not call stop() on command arrival: let the old window finish and be
  // discarded, avoiding stop/completion races inside the BLE library.
  if (!pBLEScan->start(SCAN_DURATION_SECONDS, processScanResults, false)) {
    portENTER_CRITICAL(&stateMux);
    scanMailbox.startFailed(context.generation);
    portEXIT_CRITICAL(&stateMux);
  }
}

void updateMotorFeedback() {
  const uint32_t nowMs = millis();
  if (!scanning) {
    writeMotorPwm(0);
    return;
  }

  writeMotorPwm(proximityFeedback.tick(nowMs));
}

// ===== BLE 명령 수신 콜백 =====
class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    // TX never touches this value. The SDK's single BLE event task owns RX
    // and calls us after either a regular Write or a prepared Write commit.
    // Copy here before waiting on the output mutex; do not interpret param's
    // union as write data because EXEC_WRITE supplies a different member.
    String value = pChar->getValue();
    if (value.length() == 0) return;

    // Reception is not acceptance: acceptance happens under feedbackMutex
    // below, after any previous Notify/PWM transaction has finished.
    Serial.print("[BLE] 명령 수신(처리 대기): ");
    Serial.println(value);

    if (value.indexOf("SET_TARGET_BEACON") >= 0) {
      int ti = value.indexOf("\"target\"");
      if (ti >= 0) {
        int c1 = value.indexOf(':', ti);
        int q1 = value.indexOf('"', c1);
        int q2 = value.indexOf('"', q1 + 1);
        if (q1 >= 0 && q2 > q1) {
          const String nextTarget = value.substring(q1 + 1, q2);
          feedbackTransactions.run([&]() {
            portENTER_CRITICAL(&stateMux);
            scanMailbox.requestTarget(nextTarget.c_str());
            portEXIT_CRITICAL(&stateMux);
          });
          Serial.print("[설정] 타겟 변경 요청 수락 = ");
          Serial.println(nextTarget);
        }
      }
    }
    else if (value.indexOf("START_BEACON_SCAN") >= 0) {
      feedbackTransactions.run([]() {
        portENTER_CRITICAL(&stateMux);
        scanMailbox.requestStart();
        portEXIT_CRITICAL(&stateMux);
      });
      Serial.println("[제어] 스캔 시작 요청 수락");
    }
    else if (value.indexOf("STOP_BEACON_SCAN") >= 0) {
      feedbackTransactions.run([]() {
        portENTER_CRITICAL(&stateMux);
        scanMailbox.requestStop();
        portEXIT_CRITICAL(&stateMux);
      });
      Serial.println("[제어] 스캔 중지 요청 수락");
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n===== 지팡이 (White_cane) 시작 =====");

  pinMode(MOTOR_PIN, OUTPUT);
  analogWrite(MOTOR_PIN, 0);

  if (!feedbackMutex.begin()) {
    Serial.println("[오류] 제어 잠금 생성 실패: 모터 정지, BLE 기능 중단");
    while (true) delay(1000);
  }

  BLEDevice::init(DEVICE_NAME);
  if (BLEDevice::setMTU(185) != ESP_OK) {
    Serial.println("[오류] BLE MTU 설정 실패: 모터 정지, 광고 시작 중단");
    while (true) delay(1000);
  }
  BLEDevice::setCustomGattsHandler(handleGattMetadata);

  // --- BLE 서버 (앱 명령 수신 + 상태 전송) ---
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
  );
  pNotifySubscription = new BLE2902();
  pCharacteristic->addDescriptor(pNotifySubscription);
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
    portENTER_CRITICAL(&stateMux);
    scanMailbox.requestStart();
    portEXIT_CRITICAL(&stateMux);
    Serial.println("[TEST_MODE] 자동 스캔 시작");
  } else {
    Serial.println("[대기] 앱의 START_BEACON_SCAN 명령 대기 중");
  }
}

void loop() {
  // Holding this task mutex through the actual side effects closes the
  // consume/check-to-Notify/PWM gap. A callback either accepts its command
  // before consume (old sample discarded), or after all old output ends.
  // The motor loop does not wait when a command currently owns the mutex.
  feedbackTransactions.tryRun([]() {
    consumeScanUpdate();
    updateMotorFeedback();
  });
  startNextScanIfIdle();
  delay(MOTOR_TICK_MS);
}
