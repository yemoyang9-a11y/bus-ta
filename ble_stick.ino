#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>

#define ROUTE_NO         "700-2"
#define VEHICLE_ID       "MOCK_BUS_7002_001"
#define TARGET_BEACON_ID "MOCK_BUS_7002_001"
#define IS_MOCK          true

#define COMMAND_SET_TARGET_BEACON "SET_TARGET_BEACON"
#define COMMAND_START_BEACON_SCAN "START_BEACON_SCAN"
#define COMMAND_STOP_BEACON_SCAN  "STOP_BEACON_SCAN"
#define VIBRATION_OFF    "VIBRATION_OFF"
#define VIBRATION_WEAK   "VIBRATION_WEAK"
#define VIBRATION_MEDIUM "VIBRATION_MEDIUM"
#define VIBRATION_STRONG "VIBRATION_STRONG"

BLEScan *pBLEScan;
bool targetDetected = false;
int latestRssi = -999;

String getDistanceLevel(int rssi) {
  if (rssi >= -55) return "VERY_NEAR";
  if (rssi >= -65) return "NEAR";
  if (rssi >= -75) return "APPROACHING";
  return "FAR";  // -85 이하 및 -85 초과 ~ -75 미만 모두 FAR
}

String getVibrationLevel(int rssi) {
  if (rssi >= -55) return "STRONG";
  if (rssi >= -65) return "MEDIUM";
  if (rssi >= -75) return "WEAK";
  return "OFF";
}

String getVibrationCommand(int rssi) {
  if (rssi >= -55) return VIBRATION_STRONG;
  if (rssi >= -65) return VIBRATION_MEDIUM;
  if (rssi >= -75) return VIBRATION_WEAK;
  return VIBRATION_OFF;
}

class TargetBeaconCallback : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) {
    String detectedBeaconId = "";
    if (advertisedDevice.haveName()) {
      detectedBeaconId = advertisedDevice.getName().c_str();
    }
    if (detectedBeaconId == TARGET_BEACON_ID) {
      targetDetected = true;
      latestRssi = advertisedDevice.getRSSI();

      String distanceLevel   = getDistanceLevel(latestRssi);
      String vibrationLevel  = getVibrationLevel(latestRssi);
      String vibrationCommand = getVibrationCommand(latestRssi);

      Serial.println("================================");
      Serial.println("BLE detection result");
      Serial.print("routeNo: ");          Serial.println(ROUTE_NO);
      Serial.print("vehicleId: ");        Serial.println(VEHICLE_ID);
      Serial.print("targetBeaconId: ");   Serial.println(TARGET_BEACON_ID);
      Serial.print("detectedBeaconId: "); Serial.println(detectedBeaconId);
      Serial.print("rssi: ");             Serial.println(latestRssi);
      Serial.print("distanceLevel: ");    Serial.println(distanceLevel);
      Serial.print("vibrationLevel: ");   Serial.println(vibrationLevel);
      Serial.print("vibrationCommand: "); Serial.println(vibrationCommand);
      Serial.println("detected: true");
      Serial.println("isMock: true");
      Serial.println("================================");
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("=== Smart Cane ESP32 Start ===");
  Serial.println("command: SET_TARGET_BEACON");
  Serial.print("targetBeaconId: "); Serial.println(TARGET_BEACON_ID);
  Serial.println("command: START_BEACON_SCAN");

  BLEDevice::init("SMART_CANE_ESP32");
  pBLEScan = BLEDevice::getScan();
  pBLEScan->setAdvertisedDeviceCallbacks(new TargetBeaconCallback());
  pBLEScan->setActiveScan(true);
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);
}

void loop() {
  targetDetected = false;
  latestRssi = -999;

  pBLEScan->start(3, false);

  if (!targetDetected) {
    Serial.println("================================");
    Serial.println("BLE detection result");
    Serial.print("routeNo: ");        Serial.println(ROUTE_NO);
    Serial.print("vehicleId: ");      Serial.println(VEHICLE_ID);
    Serial.print("targetBeaconId: "); Serial.println(TARGET_BEACON_ID);
    Serial.println("detected: false");
    Serial.println("distanceLevel: NOT_DETECTED");
    Serial.println("vibrationLevel: OFF");
    Serial.println("vibrationCommand: VIBRATION_OFF");
    Serial.println("isMock: true");
    Serial.println("================================");
  }

  pBLEScan->clearResults();
  delay(1000);
}