# 스마트 하차벨

하차벨 기능은 **버스 비콘 보드에 통합**되었습니다.

하나의 ESP32(`BUS_1551_001`)가 비콘 광고와 하차벨 제어를 함께 담당합니다.

## 코드 위치
- `hardware/bus-beacon/beacon_bell.ino` 참고

## 동작
- 앱에서 `STOP_REQUEST` 수신 → 릴레이(GPIO27)로 24V 하차벨 작동 + 부저(GPIO26) 알림
- 자세한 내용은 `bus-beacon/README.md` 참고
