# ESP32 버스 비콘

## 역할

버스 내부에 장착되어 BLE 광고 신호를 송출한다. 스마트지팡이가 이 신호를 감지해 어떤 버스가 정류장에 접근 중인지 식별한다.

## 비콘 ID 규칙

형식: `BUSTA-{노선번호}-{정류장코드}`  
예시: `BUSTA-360-23012340`

코드 참고: `packages/shared/src/constants/beacon-id.ts`  
시연용 데이터: `packages/shared/src/fixtures/demo-beacon.ts`

## 하드웨어 사양 (예정)

- MCU: ESP32
- 프로토콜: BLE 5.0 (iBeacon / Eddystone 포맷 TBD)
- 전원: 버스 내부 USB 또는 배터리

## 펌웨어

`hardware/bus-beacon/` 하위에 펌웨어 코드를 추가한다 (Arduino / ESP-IDF).
