/*
 * 버스 비콘 + 스마트 하차벨 겸용 (ESP32)
 *
 * [역할]
 *  - 버스 비콘: BUS_1551_001 이름으로 BLE 광고 (지팡이가 스캔해서 RSSI 측정)
 *  - 하차벨: 앱에서 STOP_REQUEST 수신 → 릴레이로 24V 하차벨 작동 + 부저 알림
 *
 * [핀]
 *  - GPIO27: 릴레이 (Active-Low, LOW=ON)
 *  - GPIO26: 능동부저 (2N2222로 구동)
 *  ※ 릴레이 핀은 문서상 GPIO28이었으나 ESP32에 28번 핀이 없어 GPIO27로 변경
 *
 * [BLE]
 *  - device name: BUS_1551_001 (서버 DB target_beacon_id와 일치, is_mock=false)
 *  - 명령 수신(Write): "STOP_REQUEST" (평문)
 *  - 응답(Notify): {"result":"SUCCESS"} 또는 {"result":"FAIL"} (JSON)
 *
 * [이름 규칙] BUS_노선번호_차량번호
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ===== 프로젝트 문서 기준 설정 =====
#define SERVICE_UUID        "4fa45540-8201-11e5-8223-0002a5d5c51b"
#define CHARACTERISTIC_UUID "4fa45541-8201-11e5-8223-0002a5d5c51b"
#define DEVICE_NAME         "BUS_1551_001"  // 비콘+하차벨 겸용, 서버 DB와 일치

// ===== 핀 설정 =====
const int RELAY_PIN = 27;   // 릴레이 (Active-Low)
const int BUZZER_PIN = 26;  // 능동부저

const int RELAY_ON  = LOW;
const int RELAY_OFF = HIGH;

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) {
    deviceConnected = true;
    Serial.println("[BLE] 앱이 연결되었습니다.");
  }
  void onDisconnect(BLEServer *pServer) {
    deviceConnected = false;
    Serial.println("[BLE] 앱 연결이 끊어졌습니다. 다시 광고를 시작합니다.");
    pServer->startAdvertising();
  }
};

class CharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String value = pCharacteristic->getValue();

    if (value.length() > 0) {
      Serial.print("[BLE] 수신한 명령: ");
      Serial.println(value);

      if (value == "STOP_REQUEST") {
        Serial.println("[벨] 하차벨 작동 요청 → 릴레이 ON + 부저 ON");
        digitalWrite(RELAY_PIN, RELAY_ON);
        digitalWrite(BUZZER_PIN, HIGH);
        delay(1000);
        digitalWrite(BUZZER_PIN, LOW);
        delay(500);
        digitalWrite(RELAY_PIN, RELAY_OFF);
        Serial.println("[벨] 릴레이 OFF, 부저 OFF, 작동 완료");

        pCharacteristic->setValue("{\"result\":\"SUCCESS\"}");
        pCharacteristic->notify();
        Serial.println("[BLE] 응답 전송: {\"result\":\"SUCCESS\"}");
      } else {
        Serial.println("[벨] 알 수 없는 명령입니다.");
        pCharacteristic->setValue("{\"result\":\"FAIL\"}");
        pCharacteristic->notify();
      }
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n===== 버스비콘+하차벨 ESP32 시작 =====");

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println("[초기화] 릴레이 OFF, 부저 OFF 상태로 시작");

  BLEDevice::init(DEVICE_NAME);
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new CharacteristicCallbacks());
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.print("[BLE] 광고 시작. 기기 이름: ");
  Serial.println(DEVICE_NAME);
  Serial.println("[대기] STOP_REQUEST를 보내보세요.");
}

void loop() {
  delay(1000);
}
