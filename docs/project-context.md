# 프로젝트 컨텍스트

## 프로젝트명

AI·BLE 기반 시각장애인 대중교통 탑승·하차 보조 시스템 (한이음 프로젝트)

## 문제 정의

시각장애인은 버스 탑승 시 ①어떤 버스인지, ②목적지에 언제 도착하는지를 자력으로 파악하기 어렵다. 특히 하차벨 누르기가 힘들어 정류장을 지나치는 경우가 발생한다.

## 핵심 기능

1. **탑승 보조**: BLE 비콘으로 접근 중인 버스를 감지하고 음성/햅틱으로 안내
2. **경로 추적**: GPS/mock 좌표로 현재 정류장·남은 정류장 수 실시간 제공
3. **자동 하차벨**: 목적지 근처 도달 시 서버가 스마트 하차벨에 명령 전송

## 주요 용어

| 용어 | 설명 |
|---|---|
| `tripId` | 한 번의 탑승 여정 식별자 |
| `requestId` | GPS/mock 위치 업데이트의 중복 방지 식별자 |
| `bellRequestId` | /bell/request ↔ /bell/result 연결용 식별자 |
| `tripStatus` | 여정 단계: WAITING_BUS → ON_BUS → NEAR_DESTINATION → TRIP_DONE |
| `bellStatus` | 하차벨 상태: NOT_REQUESTED → PENDING → SUCCESS/FAIL |
| 비콘 | ESP32 버스 비콘 (버스 내 장착) |
| 스마트지팡이 | 사용자 보유 기기, BLE Central |
| 스마트 하차벨 | 버스 내 물리 하차벨 제어 기기 |

## 제약 사항

- 비밀키·환경변수 값 절대 코드 커밋 금지
- `main` 브랜치 직접 push 금지
- 폐기 API 사용 금지: `GET /trips/{id}/bell`, `POST /api/ble/result`
