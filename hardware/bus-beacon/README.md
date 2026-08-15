# 버스 비콘 + 스마트 하차벨 (겸용)

하나의 ESP32가 버스 비콘과 하차벨 역할을 겸합니다.

## 코드
- `beacon_bell.ino`: 비콘 광고 + 하차벨 제어 겸용

## 역할
- **버스 비콘**: `BUS_1551_001` 이름으로 BLE 광고 → 지팡이가 스캔해서 RSSI 측정
- **스마트 하차벨**: 앱에서 `STOP_REQUEST` 수신 → 릴레이로 24V 하차벨 작동 + 부저 알림

## 핀 설정
- GPIO27: 릴레이 (Active-Low, LOW=ON)
- GPIO26: 부저 (2N2222로 구동)
- ※ 릴레이 핀은 문서상 GPIO28이었으나 ESP32에 28번 핀이 없어 GPIO27로 변경

## BLE
- device name: `BUS_1551_001` (서버 DB와 일치)
- Service UUID: `4fa45540-8201-11e5-8223-0002a5d5c51b`
- Characteristic UUID: `4fa45541-8201-11e5-8223-0002a5d5c51b`
- 명령 수신(Write): `STOP_REQUEST` (평문)
- 응답(Notify): `{"result":"SUCCESS"}` / `{"result":"FAIL"}` (JSON)

## 테스트 상태
- 실물 24V 하차벨 연결 → STOP_REQUEST → LED 점등 실물 확인 완료
- 릴레이, 부저 실물 작동 확인 완료
