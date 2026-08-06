# 프로젝트 컨텍스트

## 프로젝트명

AI·BLE 기반 시각장애인 대중교통 탑승·하차 보조 시스템

## 문제 정의

시각장애인은 버스를 이용할 때 버스 번호 식별, 탑승 판단, 현재 위치 확인, 하차 시점 인지에 어려움을 겪는다. 안내 방송을 놓치거나 여러 버스가 동시에 들어오는 상황에서는 잘못 탑승하거나 하차 시점을 놓칠 위험이 커진다.

## 핵심 기능

1. 탑승 보조: BLE 비콘 또는 mock 비콘으로 접근 중인 버스를 식별한다.
2. 경로 추적: GPS 또는 mock 좌표와 DB에 저장된 정류장 목록을 비교해 현재 이동 상태를 계산한다.
3. 자동 하차벨: 목적지 1정거장 전 백엔드가 `STOP_REQUEST`를 자동 생성하고 앱이 mock 또는 실제 하차벨에 전달한다.

## 주요 용어

| 용어 | 설명 |
| --- | --- |
| `tripId` | 한 번의 운행 식별자 |
| `requestId` | GPS/mock 위치 업데이트 멱등성 확인용 식별자 |
| `bellRequestId` | 하차벨 요청과 결과 연결용 식별자 |
| `tripStatus` | `WAITING_BUS`, `ON_BUS`, `NEAR_DESTINATION`, `TRIP_DONE`, `CANCELLED` |
| `bellStatus` | `NOT_REQUESTED`, `PENDING`, `SUCCESS`, `FAIL` |
| 비콘 | ESP32 버스 비콘 또는 mock 비콘 |
| 스마트지팡이 | 사용자가 보유한 BLE Central 장치 |
| 스마트 하차벨 | 버스 내 하차벨 제어 모형 |

## 제약 사항

- 실제 API 키와 비밀값은 코드 또는 문서에 작성하지 않는다.
- `main` 브랜치 직접 push는 피하고 작업 브랜치와 Pull Request를 사용한다.
- 공개 MVP 흐름에서는 `POST /api/trips/{tripId}/bell/request`를 사용하지 않는다.
- 하차벨 요청 생성은 `PATCH /api/trips/{tripId}/status`에서 자동 처리한다.
