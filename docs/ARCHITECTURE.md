# 아키텍처

> 참고 문서: 과거 구조 설명을 보존한다. 현재 역할·Realtime·상태 계약은 [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md), [API_SPEC.md](API_SPEC.md), [DB_SCHEMA.md](DB_SCHEMA.md)를 우선한다.

이 문서는 React Native 앱, Node.js/Express 백엔드, 외부 API, DB, BLE/ESP32 연동 구조를 설명합니다.

## 전체 흐름

```text
사용자 음성 입력
-> React Native 앱
-> Node.js 백엔드
-> 카카오 로컬 API
-> ODsay API
-> 후보 경로 검증
-> OpenAI API가 최종 후보 2개 선택
-> 경로 및 안내 문장 반환
-> 사용자가 경로 선택
-> POST /api/trips 내부에서 GBIS 도착정보 조회
-> DB에 운행 생성
-> mock GPS 또는 GPS 위치 업데이트
-> 하차 정류장 접근 판단
-> TTS 안내
-> BLE 또는 mock 하차벨
-> ESP32 진동 또는 하차벨 신호
```

## 프론트엔드 구조

프론트엔드는 React Native 기준입니다.

주요 책임:

- 목적지 음성 입력과 STT 처리
- 현재 GPS 좌표 확보
- `POST /api/routes/search` 호출
- 최종 후보 2개 표시 및 TTS 안내 출력
- 사용자가 선택한 후보를 `POST /api/trips`로 전달
- 중간평가에서 3초마다 mock GPS 좌표를 `PATCH /api/trips/{tripId}/status`로 전송
- `GET /api/trips/{tripId}/status`로 현재 운행 상태 조회
- `shouldTriggerBell`이 true이면 BLE 또는 mock 하차벨에 `STOP_REQUEST` 전달
- 하차벨 처리 결과를 `POST /api/trips/{tripId}/bell/result`로 전송

현재 브랜치 기준 폴더 구조:

```text
apps/mobile/
├── App.tsx
├── app.json
├── package.json
└── src/
    ├── api/
    └── demo/
```

## 백엔드 구조

백엔드는 Node.js와 Express 기준입니다.

주요 책임:

- API 요청 검증
- 카카오 목적지 좌표 변환
- 효린 `searchRoutes(destination, latitude, longitude)` 호출
- 후보 필드와 `stationList` 검증
- 유나 OpenAI 모듈에 검증된 후보 전달
- AI가 선택한 `candidateId`가 실제 후보 배열에 존재하는지 검증
- AI 실패 또는 잘못된 ID 반환 시 기본 점수 규칙으로 상위 2개 선택
- 운행 생성 시 효린 `getArrivalInfo(selectedCandidate)` 호출
- Supabase PostgreSQL에 운행과 상태 저장
- 위치 업데이트로 현재·다음·남은 정류장 계산
- 하차벨 조건을 판단해 `bellRequestId`, `STOP_REQUEST` 생성

현재 브랜치 기준 폴더 구조:

```text
apps/server/
├── package.json
└── src/
    ├── adapters/
    ├── repositories/
    ├── routes/
    ├── services/
    └── index.ts
```

## 외부 API 연동 구조

```text
카카오 로컬 API
-> 목적지 텍스트를 좌표로 변환

ODsay searchPubTransPathT
-> 출발지부터 목적지까지의 대중교통 경로 후보 조회

GBIS getBusArrivalListv2
-> 선택 후보의 gbisStationId와 localBusId로 실시간 버스 도착정보 조회

OpenAI API
-> 최종 후보 2개 선택, 추천 이유와 음성 안내 문장 생성
```

## 데이터베이스

DB는 Supabase PostgreSQL 기준입니다.

중간평가 최소 테이블:

- `trips`: 선택한 노선, 목적지, 탑승·하차 정류장, 전체 정류장 목록 저장
- `trip_status`: 현재 정류장, 다음 정류장, 남은 정류장 수, `trip_status`, `bell_status` 저장
- `bell_logs`: 하차벨 요청과 결과 기록
- `bus_beacons`: 노선·차량과 비콘 ID 매칭, 중간평가에서는 mock 가능
- `location_logs`: 위치 업데이트 로그, 선택
- `system_logs`: 서버 및 외부 API 오류 기록, 선택

상세 스키마는 [DB_SCHEMA.md](DB_SCHEMA.md)를 기준으로 합니다.

## BLE 및 ESP32 연동 구조

중간평가에서는 실제 BLE 하드웨어 연동을 필수 구현 범위에서 제외하고 mock 비콘과 mock 하차벨로 연결 구조를 검증합니다.

최종 구조:

```text
앱이 백엔드에서 targetBeaconId 조회
-> 앱이 스마트지팡이 ESP32에 targetBeaconId 전달
-> 스마트지팡이 ESP32가 BLE 비콘 스캔
-> 선택한 버스 비콘 감지
-> RSSI 기반 접근 단계 판단
-> 진동 모터 제어
```

하차벨 구조:

```text
PATCH /api/trips/{tripId}/status
-> remainingStations = 1 감지
-> 백엔드가 bellRequestId와 STOP_REQUEST 생성
-> bellStatus = PENDING
-> 앱이 실제 BLE 또는 mock 하차벨로 명령 전달
-> POST /api/trips/{tripId}/bell/result
-> bellStatus = SUCCESS 또는 FAIL
```

## stationList 검증 책임

`stationList`는 탑승 정류장부터 실제 하차 정류장까지의 전체 정류장 목록이어야 합니다.

필수 조건:

- 길이 2 이상
- 첫 항목은 `boardingStation`
- 마지막 항목은 `destinationStation`
- 탑승에서 하차 방향으로 정렬
- 각 항목은 `stationName`, `latitude`, `longitude`, `sequence` 포함
- 중간평가에서는 ODsay passStopList가 경유 정류장 `stationId`를 제공하지 않으므로 `stationId`를 사용하지 않음

조건을 충족하지 않으면 운행 생성 단계에서 `INVALID_STATION_LIST` 오류를 반환합니다.

## 장애 발생 시 대체 처리 방식

- 카카오 목적지 좌표 변환 실패: `GEOCODING_FAILED` 오류 또는 재입력 안내
- ODsay 경로 조회 실패: 외부 API 오류로 처리
- 직행 노선 없음: 오류가 아니라 빈 `routes`와 안내 문장 반환 가능
- OpenAI 실패: 백엔드 기본 점수 규칙으로 상위 2개 선택 및 기본 안내 문장 사용
- GBIS 도착정보 조회 실패: `predictedArrivalMinutes`를 `null`로 두고 운행 생성 계속
- BLE 연결 실패: 중간평가에서는 mock 하차벨 결과로 대체
- 앱 위치 업데이트 오류: 이전 상태 유지, 오류 메시지 반환
