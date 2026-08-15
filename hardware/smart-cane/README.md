# 스마트 지팡이 (White_cane)

시각장애인이 버스를 찾을 수 있도록 BLE 비콘을 스캔해 거리·상태를 진동으로 안내하는 ESP32 코드입니다.

## 코드
- `ble_stick.ino`

## 역할
- **BLE 스캔**: 버스 비콘(`BUS_1551_001`)을 스캔해서 RSSI로 거리·상태 판정
- **진동 안내**: 상태에 따라 진동모터(GPIO25) 제어
- **앱 명령 수신**: 앱에서 스캔 시작/중지, 타겟 비콘 지정
- **상태 전송**: 판정한 상태를 앱에 Notify로 전송 (진동 + 음성 안내 연동용)

## 핀 설정
- GPIO25: 진동모터
  - 개발/테스트: 진동모터 모듈
  - 최종: 원통형 진동모터(DVM6C-J) + 2N2222 트랜지스터 회로

## BLE
- device name: `White_cane`
- Service UUID: `4fa45540-8201-11e5-8223-0002a5d5c51b`
- Characteristic UUID: `4fa45541-8201-11e5-8223-0002a5d5c51b`
- 명령 수신(Write, JSON):
  - `{"cmd":"SET_TARGET_BEACON","target":"BUS_1551_001"}`
  - `{"cmd":"START_BEACON_SCAN"}`
  - `{"cmd":"STOP_BEACON_SCAN"}`
- 상태 전송(Notify, JSON):
  - `{"state":"APPROACHING","rssi":-65}`
  - state 종류: APPROACHING / ARRIVED / PASSING / PASSED_STOPPED / LEAVING

## 상태 판정
RSSI 평균+추세 기반으로 버스 상태를 판정합니다:
- **APPROACHING**: 접근 중
- **ARRIVED**: 다가와서 앞에 정차 (탈 수 있음)
- **PASSING**: 지나가는 중 (진동 억제)
- **PASSED_STOPPED**: 지나가서 다른 곳 정차 (이동 필요)
- **LEAVING**: 멀어짐

## 테스트 상태
- BLE 스캔, RSSI 측정, 진동 제어 실물 확인 완료
- 상태 판정 기준값은 실환경 거리 테스트로 조정 예정 (현재 근접 테스트 기준)
- 진동 세기(PWM) 조절은 최종 모터 전환 시 추가 예정
