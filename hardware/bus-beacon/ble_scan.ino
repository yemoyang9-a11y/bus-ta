#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLEAdvertising.h>

#define ROUTE_NO         "1551"
#define VEHICLE_ID       "MOCK_BUS_1551_001"
#define TARGET_BEACON_ID "MOCK_BUS_1551_001"
#define IS_MOCK          true

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("=== Bus Beacon ESP32 Start ===");
  Serial.print("routeNo: ");        Serial.println(ROUTE_NO);
  Serial.print("vehicleId: ");      Serial.println(VEHICLE_ID);
  Serial.print("targetBeaconId: "); Serial.println(TARGET_BEACON_ID);
  Serial.println("isMock: true");

  BLEDevice::init(TARGET_BEACON_ID);
  BLEServer *server = BLEDevice::createServer();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();

  // Advertising 데이터
  BLEAdvertisementData advertisementData;
  advertisementData.setName(TARGET_BEACON_ID);
  advertising->setAdvertisementData(advertisementData);

  // Scan Response 데이터 (nRF Connect 등에서 이름 확인용)
  BLEAdvertisementData scanResponseData;
  scanResponseData.setName(TARGET_BEACON_ID);
  advertising->setScanResponseData(scanResponseData);

  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMaxPreferred(0x12);

  BLEDevice::startAdvertising();
  Serial.println("BLE Advertising started.");
}

void loop() {
  Serial.println("Advertising targetBeaconId: " TARGET_BEACON_ID);
  delay(3000);
}
