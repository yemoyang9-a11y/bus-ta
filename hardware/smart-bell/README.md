# 스마트 하차벨

## 역할

서버의 하차벨 요청(`POST /api/trips/{tripId}/bell/request`)을 수신하고 물리적 하차벨을 동작시킨다. 결과를 서버(`POST /api/trips/{tripId}/bell/result`)로 보고한다.

## 명령 상수

`packages/shared/src/constants/bell-command.ts` 참고

| 명령 | 의미 |
|---|---|
| `RING` | 하차벨 울림 |
| `CANCEL` | 하차벨 취소 |

## 하드웨어 사양 (예정)

- MCU: ESP32
- 연결: Wi-Fi → 서버 API
- 출력: 릴레이로 물리 하차벨 제어

## 펌웨어

`hardware/smart-bell/` 하위에 펌웨어 코드를 추가한다.
