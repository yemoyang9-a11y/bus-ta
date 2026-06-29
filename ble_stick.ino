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
  return "FAR";  // -85 μ΄ν• λ° -85 μ΄κ³Ό ~ -75 λ―Έλ§ λª¨λ‘ FAR
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
      Serial.print("vibrationLevel: ");   Serial.priintln(vibrationLevel);
      Serial.print(‰Ω¥‰Ι…Ρ¥½Ή½µµ…Ήθ€¤μM•Ι¥…°ΉΑΙ¥ΉΡ±Έ΅Ω¥‰Ι…Ρ¥½Ή½µµ…Ή¤μ4(€€€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰‘•Ρ•Ρ•θΡΙΥ”¤μ4(€€€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰¥Ν5½¬θΡΙΥ”¤μ4(€€€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ττττττττττττττττττττττττττττττττ¤μ4(€€€τ4(€τ4)τμ4(4)Ω½¥Ν•ΡΥΐ ¤μ4(€M•Ι¥…°Ή‰•¥Έ ΔΔΤΘΐΐ¤μ4(€‘•±…δ Δΐΐΐ¤μ4(4(€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ τττMµ…ΙΠ…Ή”M@ΜΘMΡ…ΙΠ€τττ¤μ4(€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰½µµ…ΉθMQ}QIQ}	=8¤μ4(€M•Ι¥…°ΉΑΙ¥ΉΠ ‰Ρ…Ι•Ρ	•…½Ή%θ€¤μM•Ι¥…°ΉΑΙ¥ΉΡ±Έ΅QIQ}	=9}%¤μ4(€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰½µµ…ΉθMQIQ}	=9}M8¤μ4(4(€	1•Ω¥”θι¥Ή¥Π ‰M5IQ}9}M@ΜΘ¤μ4(€Α	1M…Έ€τ	1•Ω¥”θι•ΡM…Έ ¤μ4(€Α	1M…Έ΄ωΝ•Ρ‘Ω•ΙΡ¥Ν•‘•Ω¥•…±±‰…­Μ΅Ή•άQ…Ι•Ρ	•…½Ή…±±‰…¬ ¤¤μ4(€Α	1M…Έ΄ωΝ•ΡΡ¥Ω•M…Έ΅ΡΙΥ”¤μ4(€Α	1M…Έ΄ωΝ•Ρ%ΉΡ•ΙΩ…° Δΐΐ¤μ4(€Α	1M…Έ΄ωΝ•Ρ]¥Ή‘½ά δδ¤μ4)τ4(4)Ω½¥±½½ΐ ¤μ4(€Ρ…Ι•Ρ•Ρ•Ρ•€τ™…±Ν”μ4(€±…Ρ•ΝΡIΝΝ¤€τ€΄δδδμ4(4(€Α	1M…Έ΄ωΝΡ…ΙΠ Μ°™…±Ν”¤μ4(4(€¥€ …Ρ…Ι•Ρ•Ρ•Ρ•¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ττττττττττττττττττττττττττττττττ¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰	1‘•Ρ•Ρ¥½ΈΙ•ΝΥ±Π¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΠ ‰Ι½ΥΡ•9Όθ€¤μ€€€€€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ΅I=UQ}9<¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΠ ‰Ω•΅¥±•%θ€¤μ€€€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ΅Y!%1}%¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΠ ‰Ρ…Ι•Ρ	•…½Ή%θ€¤μM•Ι¥…°ΉΑΙ¥ΉΡ±Έ΅QIQ}	=9}%¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰‘•Ρ•Ρ•θ™…±Ν”¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰‘¥ΝΡ…Ή•1•Ω•°θ9=Q}QQ¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰Ω¥‰Ι…Ρ¥½Ή1•Ω•°θ=¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰Ω¥‰Ι…Ρ¥½Ή½µµ…ΉθY%	IQ%=9}=¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ‰¥Ν5½¬θΡΙΥ”¤μ4(€€€M•Ι¥…°ΉΑΙ¥ΉΡ±Έ ττττττττττττττττττττττττττττττττ¤μ4(€τ4(4(€Α	1M…Έ΄ω±•…ΙI•ΝΥ±ΡΜ ¤μ4(€‘•±…δ Δΐΐΐ¤μ4)