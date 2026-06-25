# 스마트 하차벨

## 역할

하차 1정거장 전 백엔드가 `PATCH /api/trips/{tripId}/status` 처리 중 자동 생성한 `STOP_REQUEST` 명령을 (앱 경유로) 수신하고 물리적 하차벨을 동작시킨다. 결과를 서버(`POST /api/trips/{tripId}/bell/result`)로 보고한다.

> 별도 `POST /api/trips/{tripId}/bell/request` 엔드포인트는 사용하지 않는다 (폐기됨).

## 명령 상수

`packages/shared/src/constants/bell-command.ts` 참고

| 명령 | 의미 |
|---|---|
| `STOP_REQUEST` | 하차벨 울림 (MVP 단일 명령) |

## 하드웨어 사양 (예정)

- MCU: ESP32
- 연결: Wi-Fi → 서버 API
- 출력: 릴레이로 물리 하차벨 제어

## 펌웨어

`hardware/smart-bell/` 하위에 펌웨어 코드를 추가한다.
