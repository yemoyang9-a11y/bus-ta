# 7/1 중간평가 개발 범위

> 역사 문서: 이 문서는 2026-07-01 중간평가 범위를 기록한다. 현재 API·상태·Realtime 계약은 [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md), [API_SPEC.md](API_SPEC.md), [DB_SCHEMA.md](DB_SCHEMA.md)를 우선한다.

이 문서는 2026년 7월 1일 중간평가에서 구현하고 시연할 범위를 정리합니다. 목표는 기능 수를 늘리는 것이 아니라, 사용자 입력부터 하차 판단까지 하나의 핵심 흐름이 실제로 연결되어 동작하는 모습을 보여주는 것입니다.

## 2026-06-25 확정 사항

- `POST /api/routes/search`는 카카오 목적지 좌표 변환 후 효린의 ODsay 기반 `searchRoutes()`를 호출한다.
- 중간평가에서는 환승 없는 직행 버스 후보만 사용한다.
- ODsay 경로 유형 값은 공개 API와 DB에 포함하지 않는다.
- 유나 AI 모듈은 검증된 여러 후보 중 최종 후보 2개를 선택하고 각 후보의 추천 이유와 안내 문장을 생성한다.
- 노선 검색 단계에서는 `predictedArrivalMinutes`를 반환하지 않는다.
- 사용자가 최종 노선을 선택하면 `POST /api/trips` 내부에서 `getArrivalInfo(selectedCandidate)`를 호출해 `predictedArrivalMinutes`를 조회한다.
- GBIS 도착정보 조회 실패 시 두 값은 `null`로 두고 운행 생성은 계속한다.
- 별도 공개 도착정보 조회 API는 만들지 않는다.
- `stationList`는 탑승부터 목적지까지의 전체 정류장을 포함해야 한다.

## 중간평가 성공 기준

```text
사용자가 앱에서 목적지를 음성으로 말함
-> STT가 목적지 텍스트로 변환
-> 앱이 현재 GPS 좌표와 목적지를 백엔드로 전송
-> 백엔드가 카카오·ODsay·GBIS 보조 조회를 이용해 노선 후보 조회
-> OpenAI가 최종 후보 2개와 안내 문장을 생성
-> 앱에 후보와 안내 문장 반환
-> 사용자가 노선 선택
-> 선택한 노선과 이동 정보를 저장
-> mock GPS 좌표를 순서대로 전송하며 이동 상황 재현
-> 현재 정류장·다음 정류장·남은 정류장 계산
-> 하차 2정거장 전 사전 안내
-> 하차 1정거장 전 하차벨 명령 생성
-> 앱이 하차 안내 화면으로 전환하고 TTS 안내 출력
```

## 이번 평가에서 하지 않는 것

- 스마트지팡이 완제품 제작 및 실물 시연
- 앱과 스마트지팡이 ESP32 간 실제 BLE 연동
- 선택한 버스 비콘의 실시간 탐지
- RSSI에 따른 실제 진동 세기 제어
- 실제 LED·부저·하차벨 작동
- 환승 포함 다중 경로 탐색
- 사용자 인증·로그인·관리자 기능
- 장거리 실시간 GPS 주행 테스트

## 담당 흐름

```text
[앱 음성 입력·STT]
채린
   ↓
[목적지 + 현재 GPS 좌표 전송]
채린 -> 예모 백엔드
   ↓
[목적지 좌표 변환·ODsay 경로 후보 조회]
효린 API 모듈 -> 예모 백엔드
   ↓
[AI 최종 후보 2개 선택 및 안내 생성]
예모 백엔드 -> 유나 안내 모듈
   ↓
[노선 후보 및 안내 문장 반환]
예모 백엔드 -> 채린 앱
   ↓
[사용자 노선 선택 및 운행 생성]
채린 앱 -> 예모 백엔드·DB
   ↓
[mock GPS 이동 시뮬레이션]
채린 앱 또는 시연 도구 -> 예모 백엔드
   ↓
[현재/다음 정류장 및 하차 시점 판단]
예모 백엔드
   ↓
[STOP_REQUEST 생성 및 결과 저장]
예모 백엔드 <-> 채린 앱
```

## 중간평가용 주요 API

- `GET /api/health`
- `POST /api/routes/search`
- `POST /api/trips`
- `GET /api/beacons?routeNo=`
- `PATCH /api/trips/{tripId}/status`
- `GET /api/trips/{tripId}/status`
- `POST /api/trips/{tripId}/bell/result`
- `PATCH /api/trips/{tripId}`

## mock 데이터 기준

- 위치 이동은 앱이 3초마다 선택된 실제 노선의 정류장 좌표를 mock 위치로 전송한다.
- mock 위치 요청에는 `source: "MOCK"`, `isMock: true`를 포함할 수 있다.
- mock 비콘 ID 형식은 `MOCK_BUS_{routeToken}_{vehicleToken}`을 사용한다.
- 예: `MOCK_BUS_7002_001`

## 하차 조건

```text
remainingStations = 2
-> 사전 안내만 제공
-> shouldTriggerBell = false

remainingStations = 1
AND bellStatus = NOT_REQUESTED
-> 백엔드가 bellRequestId와 STOP_REQUEST 생성
-> bellStatus = PENDING
-> shouldTriggerBell = true

bellStatus = PENDING 또는 SUCCESS
-> shouldTriggerBell = false
```

## 통합 전 확인 사항

- 앱 요청 JSON의 필드명이 `docs/API_SPEC.md`와 동일한가
- 백엔드가 효린 `searchRoutes()` 결과의 `stationList`를 검증하는가
- 유나 모듈이 최종 후보 2개 선택과 안내 문장을 반환하는가
- OpenAI가 반환한 `candidateId`를 실제 후보 배열과 대조하는가
- mock 데이터와 실제 API 데이터가 구분되어 있는가
- 하차벨 신호가 한 번만 생성되는가
- 외부 API 오류 시 예비 mock 시나리오가 있는가
