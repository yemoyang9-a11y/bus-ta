# API 명세

이 문서는 React Native 프론트엔드와 Node.js/Express 백엔드의 중간평가용 API 계약을 정의합니다. 최신 기준은 2026-06-25 Notion 확정 내용과 효린 `routeSearch.js` 현재 명세입니다.

공개 API 필드는 `camelCase`, DB 컬럼은 `snake_case`를 사용합니다. DB 매핑은 [DB_SCHEMA.md](DB_SCHEMA.md)를 기준으로 합니다.

## 최종 확정 기준

### 위치 업데이트와 하차벨

```text
앱
-> PATCH /api/trips/{tripId}/status
-> 백엔드가 DB에 저장된 stationList와 현재 좌표 비교
-> currentStation / nextStation / remainingStations 계산
-> remainingStations = 1 AND bellStatus = NOT_REQUESTED 감지
-> 백엔드가 bellRequestId 생성
-> bell_logs에 STOP_REQUEST 요청 기록 생성
-> trip_status.bellStatus = PENDING 저장
-> 앱에 bellRequestId, command: STOP_REQUEST 반환
-> 앱이 mock 또는 실제 하차벨에 STOP_REQUEST 전달
-> POST /api/trips/{tripId}/bell/result
-> bellStatus = SUCCESS 또는 FAIL 저장
```

규칙:

- `POST /api/trips/{tripId}/bell/request`는 사용하지 않습니다.
- 하차벨 요청 생성은 `PATCH /api/trips/{tripId}/status` 안에서 자동 처리합니다.
- `GET /api/trips/{tripId}/status`는 조회용이며 하차벨 요청을 새로 생성하지 않습니다.
- `POST /api/trips/{tripId}/bell/result`는 이미 생성된 `bellRequestId`의 결과만 저장합니다.

### 효린 모듈 연동

```javascript
const { searchRoutes, getArrivalInfo } = require("./routeSearch");

const searchResult = await searchRoutes(destination, latitude, longitude);
const selectedCandidate = searchResult.candidates[index];
const arrival = await getArrivalInfo(selectedCandidate);
```

규칙:

- `getArrivalInfo()`에는 좌표와 `routeId`를 개별 인자로 넘기지 않습니다.
- `getArrivalInfo(selectedCandidate)`처럼 효린 `candidates` 배열의 후보 객체 1개를 전달합니다.
- `selectedCandidate.gbisStationId`는 ODsay `startLocalStationID`이며 GBIS `stationId`로 사용합니다.
- `selectedCandidate.localBusId`는 ODsay `busLocalBlID`이며 GBIS `routeId` 형식으로 사용합니다.

### 사용하지 않는 구버전 항목

- `POST /api/trips/{tripId}/bell/request`
- `routeId` 기반 운행 생성 요청
- 정류장 객체의 `stationId`
- `routeDirection`, `endStationName`
- 노선 검색 단계의 `predictedArrivalMinutes`
- 별도 `GET /api/trips/{tripId}/bell`
- 별도 `POST /api/routes/arrival-info`
- `bellAlreadyTriggered`, `bellTriggered`, `BELL_TRIGGERED`

## 공통 응답 형식

성공 응답:

```json
{
  "success": true,
  "message": "요청 처리 결과",
  "timestamp": "2026-07-01T14:30:00+09:00"
}
```

오류 응답:

```json
{
  "success": false,
  "errorCode": "INVALID_REQUEST",
  "message": "요청 데이터가 올바르지 않습니다.",
  "timestamp": "2026-07-01T14:30:00+09:00"
}
```

## 공통 정류장 객체

ODsay `passStopList`에서 경유 정류장의 고유 `stationId`를 제공하지 않으므로 중간평가에서는 `stationName`, 좌표, `sequence`로 정류장을 표현합니다.

```json
{
  "stationName": "오목천역.영신여자고교.청구아파트",
  "latitude": 37.242027,
  "longitude": 126.962801,
  "sequence": 0
}
```

규칙:

- `stationId`는 중간평가 API 요청/응답에 포함하지 않습니다.
- `boardingStation`과 `destinationStation`에는 `sequence`가 없어도 됩니다.
- `stationList`의 각 항목에는 `sequence`를 포함합니다.
- `sequence`는 오름차순이어야 하지만 불연속일 수 있습니다.
- 남은 정류장 계산은 `sequence` 차이가 아니라 `stationList` 배열 인덱스 기준입니다.

## 공개 API 목록

```text
GET   /api/health
POST  /api/routes/search
POST  /api/trips
PATCH /api/trips/{tripId}            # 미구현 (중간평가 범위 밖, 시연 재시작 장면 없음)
PATCH /api/trips/{tripId}/status
GET   /api/trips/{tripId}/status
GET   /api/beacons?routeNo=
POST  /api/trips/{tripId}/bell/result
```

## GET /api/health

- 기능 이름: 서버 상태 확인
- HTTP 메서드: `GET`
- 요청 주소: `/api/health`
- 프론트엔드 사용 위치: 앱 초기 연결 확인 또는 개발 점검

성공 응답:

```json
{
  "success": true,
  "serverStatus": "UP",
  "dbStatus": "UP",
  "message": "Server is running",
  "timestamp": "2026-07-01T14:30:00+09:00"
}
```

상태 코드: `200`, `500`

DB 미연결 개발 단계에서는 `dbStatus: "NOT_CONFIGURED"`를 반환할 수 있습니다.

Supabase 환경변수가 설정되어 있지만 연결 확인에 실패하면 `500`과 함께 다음 형식을 반환합니다.

```json
{
  "success": false,
  "serverStatus": "UP",
  "dbStatus": "DOWN",
  "message": "Supabase connection failed",
  "timestamp": "2026-07-01T14:30:00+09:00"
}
```

## POST /api/routes/search

- 기능 이름: 노선 후보 검색
- HTTP 메서드: `POST`
- 요청 주소: `/api/routes/search`
- 프론트엔드 사용 위치: 목적지 입력 후 경로 후보 화면

요청 Body:

```json
{
  "destination": "수원대학교",
  "latitude": 37.2433596329495,
  "longitude": 126.963902835862
}
```

처리 흐름:

```text
요청값 검증
-> 효린 searchRoutes(destination, latitude, longitude) 호출
-> 카카오 Geocoding
-> ODsay 경로탐색
-> 환승 없는 직행 버스 후보 필터링
-> 백엔드 후보 필드와 stationList 검증
-> 유나 AI 모듈이 최종 후보 2개 선택 및 안내 문장 생성
-> 앱에 최종 후보 반환
```

성공 응답:

```json
{
  "success": true,
  "destination": "수원대학교",
  "routes": [
    {
      "candidateId": 1,
      "routeNo": "700-2",
      "localBusId": "234000021",
      "gbisStationId": "201000166",
      "boardingStation": {
        "stationName": "오목천역.영신여자고교.청구아파트",
        "latitude": 37.242027,
        "longitude": 126.962801
      },
      "destinationStation": {
        "stationName": "수원대학교",
        "latitude": 37.213789,
        "longitude": 126.979749
      },
      "stationList": [
        {
          "stationName": "오목천역.영신여자고교.청구아파트",
          "latitude": 37.242027,
          "longitude": 126.962801,
          "sequence": 0
        },
        {
          "stationName": "수영오거리.방송통신대입구",
          "latitude": 37.237447,
          "longitude": 126.962515,
          "sequence": 1
        },
        {
          "stationName": "수원대학교",
          "latitude": 37.213789,
          "longitude": 126.979749,
          "sequence": 10
        }
      ],
      "totalTime": 30,
      "totalWalk": 825,
      "payment": 1650,
      "busTransitCount": 1,
      "busStationCount": 10,
      "totalDistance": 4653,
      "intervalTime": 15,
      "recommendationReason": "환승이 없고 이동 구조가 단순합니다.",
      "guideMessage": "700-2번 버스를 이용할 수 있습니다."
    }
  ],
  "message": "노선 후보를 조회했습니다.",
  "timestamp": "2026-07-01T14:30:00+09:00"
}
```

규칙:

- `routes`의 각 항목은 효린 `candidates` 객체 형식을 기반으로 합니다.
- 노선 검색 단계에서는 `predictedArrivalMinutes`를 반환하지 않습니다.
- 도착 예정 시간은 사용자가 후보를 선택한 뒤 `POST /api/trips` 내부에서 `getArrivalInfo(selectedCandidate)`로 조회합니다.
- `routeDirection`, `endStationName`, `stationId`는 포함하지 않습니다.
- 직행 버스 후보가 없으면 `success: true`, `routes: []`를 반환할 수 있습니다.
- 외부 API 자체 오류는 `success: false`, `BUS_API_ERROR`로 반환합니다.
- 공개 API에는 ODsay 내부 경로 유형 값을 포함하지 않습니다.

필수 필드: `destination`, `latitude`, `longitude`

상태 코드: `200`, `400`, `502`

## POST /api/trips

- 기능 이름: 선택 노선으로 운행 생성
- HTTP 메서드: `POST`
- 요청 주소: `/api/trips`
- 프론트엔드 사용 위치: 사용자가 최종 후보를 선택한 직후

요청 Body:

```json
{
  "destination": "수원대학교",
  "candidateId": 1,
  "routeNo": "700-2",
  "localBusId": "234000021",
  "gbisStationId": "201000166",
  "boardingStation": {
    "stationName": "오목천역.영신여자고교.청구아파트",
    "latitude": 37.242027,
    "longitude": 126.962801
  },
  "destinationStation": {
    "stationName": "수원대학교",
    "latitude": 37.213789,
    "longitude": 126.979749
  },
  "stationList": [
    {
      "stationName": "오목천역.영신여자고교.청구아파트",
      "latitude": 37.242027,
      "longitude": 126.962801,
      "sequence": 0
    },
    {
      "stationName": "수영오거리.방송통신대입구",
      "latitude": 37.237447,
      "longitude": 126.962515,
      "sequence": 1
    },
    {
      "stationName": "수원대학교",
      "latitude": 37.213789,
      "longitude": 126.979749,
      "sequence": 10
    }
  ],
  "totalTime": 30,
  "totalWalk": 825,
  "payment": 1650,
  "busTransitCount": 1,
  "busStationCount": 10,
  "totalDistance": 4653,
  "intervalTime": 15
}
```

처리 흐름:

```text
선택 후보와 stationList 검증
-> 직전 검색 결과와 candidateId 대조, 저장 방식 확인 필요
-> getArrivalInfo(selectedCandidate) 호출
-> gbisStationId, localBusId, predictedArrivalMinutes 반영
-> tripId 발급
-> trips 저장
-> trip_status 초기 생성
-> tripStatus = WAITING_BUS
-> bellStatus = NOT_REQUESTED
```

성공 응답:

```json
{
  "success": true,
  "tripId": "trip-001",
  "routeNo": "700-2",
  "localBusId": "234000021",
  "gbisStationId": "201000166",
  "predictedArrivalMinutes": 6,
  "tripStatus": "WAITING_BUS",
  "bellStatus": "NOT_REQUESTED",
  "shouldTriggerBell": false,
  "createdAt": "2026-07-01T14:31:00+09:00",
  "message": "선택한 노선으로 운행을 생성했습니다.",
  "timestamp": "2026-07-01T14:31:00+09:00"
}
```

GBIS 조회 실패 시에도 운행 생성은 계속합니다.

```json
{
  "gbisStationId": "201000166",
  "localBusId": "234000021",
  "predictedArrivalMinutes": null
}
```

검증 규칙:

- `stationList`는 2개 이상의 정류장을 포함합니다.
- `boardingStation`은 `stationList`의 첫 항목과 `stationName`·좌표가 같아야 합니다.
- `destinationStation`은 `stationList`의 마지막 항목과 `stationName`·좌표가 같아야 합니다.
- 동일 `stationName`과 동일 좌표의 중복 정류장을 허용하지 않습니다.
- 모든 위도와 경도는 정상 범위여야 합니다.
- `sequence`는 오름차순이어야 하지만 불연속일 수 있습니다.
- 탑승 정류장과 목적지 정류장은 서로 달라야 합니다.

필수 필드: `destination`, `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, `boardingStation`, `destinationStation`, `stationList`

상태 코드: `201`, `400`, `404`, `502`

## GET /api/beacons?routeNo=

- 기능 이름: 노선별 비콘 정보 조회
- HTTP 메서드: `GET`
- 요청 주소: `/api/beacons?routeNo=700-2`
- 프론트엔드 사용 위치: 중간평가 mock 비콘 확인
- 데이터 출처: Supabase `bus_beacons` 테이블(환경변수 설정 시) 또는 fixture(`DEMO_BEACONS`, 미설정 시 대체)

성공 응답:

```json
{
  "success": true,
  "routeNo": "700-2",
  "targetBeaconId": "MOCK_BUS_7002_001",
  "isMock": true,
  "message": "중간평가용 mock 비콘 정보를 반환했습니다.",
  "timestamp": "2026-07-01T14:32:00+09:00"
}
```

최종 단계에서는 `vehicleId`를 포함하거나 `GET /api/trips/{tripId}/beacon`으로 확장합니다.

필수 필드: `routeNo`

상태 코드: `200`, `400`, `404`

## PATCH /api/trips/{tripId}/status

- 기능 이름: GPS 또는 mock 위치 기반 상태 업데이트
- HTTP 메서드: `PATCH`
- 요청 주소: `/api/trips/{tripId}/status`
- 프론트엔드 사용 위치: 탑승 중 화면, mock 이동 시뮬레이션

요청 Body:

```json
{
  "requestId": "location-001",
  "latitude": 37.237447,
  "longitude": 126.962515,
  "recordedAt": "2026-07-01T14:35:00+09:00",
  "source": "MOCK"
}
```

처리 내용:

- 앱이 약 3초마다 실제 GPS 또는 mock GPS 좌표를 전송합니다.
- 백엔드는 현재 정류장, 다음 정류장, 남은 정류장 수를 계산하고 DB를 갱신합니다.
- 동일한 `tripId + requestId` 재요청은 새 로그와 새 하차벨 요청 없이 기존 계산 결과를 재반환합니다.
- `remainingStations = 1`이고 `bellStatus = NOT_REQUESTED`이면 백엔드가 하차벨 요청을 자동 생성합니다.

하차벨 자동 생성 성공 응답:

```json
{
  "success": true,
  "tripId": "trip-001",
  "currentStation": {
    "stationName": "수영오거리.방송통신대입구",
    "latitude": 37.237447,
    "longitude": 126.962515,
    "sequence": 1
  },
  "nextStation": {
    "stationName": "수원대학교",
    "latitude": 37.213789,
    "longitude": 126.979749,
    "sequence": 10
  },
  "remainingStations": 1,
  "tripStatus": "NEAR_DESTINATION",
  "bellStatus": "PENDING",
  "shouldTriggerBell": true,
  "bellRequestId": "bell-request-001",
  "command": "STOP_REQUEST",
  "guideMessage": "하차까지 한 정류장 남았습니다. 다음 정류장에서 하차하세요.",
  "source": "MOCK",
  "message": "이동 상태를 갱신하고 하차벨 요청을 생성했습니다.",
  "timestamp": "2026-07-01T14:35:00+09:00"
}
```

하차벨 자동 생성 조건:

```text
remainingStations = 1
AND bellStatus = NOT_REQUESTED
```

자동 생성 시 백엔드 작업:

1. `bellRequestId` 생성
2. `command: STOP_REQUEST` 생성
3. `bell_logs` 요청 로그 저장
4. `trip_status.bellStatus = PENDING` 저장
5. 해당 응답에 `shouldTriggerBell: true`, `bellRequestId`, `command` 포함

처리 규칙:

- 역행 판단과 다중 점프 판단은 `sequence` 값이 아니라 `stationList` 배열 인덱스를 기준으로 합니다.
- 새 후보의 배열 인덱스가 기존 현재 정류장 인덱스보다 작으면 `BACKWARD_STATION_IGNORED`로 무시할 수 있습니다.
- 새 후보의 배열 인덱스가 기존 인덱스보다 2칸 이상 앞서면 한 칸만 전진시키고 `FORWARD_JUMP_CLAMPED`로 처리할 수 있습니다.
- 첫 mock 좌표 처리 시 `WAITING_BUS -> ON_BUS`로 변경합니다.
- 남은 정류장이 2이면 사전 안내만 제공하고 `ON_BUS`를 유지합니다.
- 남은 정류장이 1이면 `NEAR_DESTINATION`으로 변경하고, `bellStatus = NOT_REQUESTED`일 때 하차벨 요청을 생성합니다.
- 남은 정류장이 0이면 `TRIP_DONE`, `nextStation: null`로 변경합니다.
- `bellStatus`가 `PENDING`, `SUCCESS`, `FAIL`이면 중복 하차벨 요청을 만들지 않습니다.

남은 정류장 계산:

```text
remainingStations = destinationStation의 stationList 배열 인덱스 - currentStation의 stationList 배열 인덱스
```

필수 필드: `requestId`, `latitude`, `longitude`, `recordedAt`, `source`

상태 코드: `200`, `400`, `404`, `409`

## GET /api/trips/{tripId}/status

- 기능 이름: 현재 이동 상태 조회
- HTTP 메서드: `GET`
- 요청 주소: `/api/trips/{tripId}/status`
- 프론트엔드 사용 위치: 탑승 중 화면, 하차 안내 화면

성공 응답:

```json
{
  "success": true,
  "tripId": "trip-001",
  "destination": "수원대학교",
  "routeNo": "700-2",
  "currentStation": {
    "stationName": "수영오거리.방송통신대입구",
    "latitude": 37.237447,
    "longitude": 126.962515,
    "sequence": 1
  },
  "nextStation": {
    "stationName": "수원대학교",
    "latitude": 37.213789,
    "longitude": 126.979749,
    "sequence": 10
  },
  "remainingStations": 1,
  "tripStatus": "NEAR_DESTINATION",
  "bellStatus": "PENDING",
  "shouldTriggerBell": false,
  "bellRequestId": "bell-request-001",
  "command": null,
  "guideMessage": "하차벨 요청 결과를 기다리고 있습니다.",
  "message": "현재 이동 상태를 조회했습니다.",
  "timestamp": "2026-07-01T14:35:03+09:00"
}
```

규칙:

- 이 API는 상태를 조회합니다.
- 이 API는 하차벨 요청을 새로 생성하지 않습니다.
- 하차벨 요청 자동 생성은 `PATCH /api/trips/{tripId}/status`에서만 수행합니다.
- `bellStatus`가 `PENDING`, `SUCCESS`, `FAIL`이면 `shouldTriggerBell: false`, `command: null`을 반환합니다.

필수 필드: URL의 `tripId`

상태 코드: `200`, `404`

## POST /api/trips/{tripId}/bell/result

- 기능 이름: 하차벨 작동 결과 저장
- HTTP 메서드: `POST`
- 요청 주소: `/api/trips/{tripId}/bell/result`
- 프론트엔드 사용 위치: BLE 또는 mock 하차벨 명령 전달 이후

요청 Body:

```json
{
  "bellRequestId": "bell-request-001",
  "command": "STOP_REQUEST",
  "result": "SUCCESS",
  "resultMessage": "mock 하차벨 작동 성공",
  "isMock": true,
  "timestamp": "2026-07-01T14:36:05+09:00"
}
```

성공 응답:

```json
{
  "success": true,
  "tripId": "trip-001",
  "bellStatus": "SUCCESS",
  "tripStatus": "NEAR_DESTINATION",
  "message": "하차벨 작동 결과를 저장했습니다.",
  "timestamp": "2026-07-01T14:36:05+09:00"
}
```

실패 결과 저장 응답:

```json
{
  "success": true,
  "tripId": "trip-001",
  "bellStatus": "FAIL",
  "tripStatus": "NEAR_DESTINATION",
  "message": "하차벨 작동에 실패했습니다.",
  "timestamp": "2026-07-01T14:36:05+09:00"
}
```

처리 규칙:

- `bellRequestId`는 `PATCH /status`에서 백엔드가 생성한 값이어야 합니다.
- `bellStatus = PENDING` 상태에서만 정상 결과로 처리합니다.
- `result = SUCCESS`이면 `bellStatus = SUCCESS`로 변경합니다.
- `result = FAIL`이면 `bellStatus = FAIL`로 변경합니다.
- 같은 `bellRequestId`의 결과 요청이 재전송되면 중복 로그를 만들지 않고 기존 결과를 200으로 재반환합니다.
- 이 API는 `NOT_REQUESTED -> PENDING` 전환을 하지 않습니다.
- 실패 후 자동 재시도 정책은 중간평가 구현 전 확인 필요입니다.

필수 필드: `bellRequestId`, `command`, `result`, `timestamp`

선택 필드: `resultMessage`, `isMock`

상태 코드: `200`, `400`, `404`, `409`

## PATCH /api/trips/{tripId}

> 미구현. 중간평가 범위 밖이며 시연에 운행 취소/재시작 장면이 없어 보류한다.
> 현재 서버는 이 경로에 `501 Not implemented` 를 반환한다. 아래는 향후 구현 시 기준 명세이다.

- 기능 이름: 운행 취소 또는 종료
- HTTP 메서드: `PATCH`
- 요청 주소: `/api/trips/{tripId}`
- 프론트엔드 사용 위치: 시연 재시작, 사용자가 운행 취소

요청 Body:

```json
{
  "action": "CANCEL"
}
```

성공 응답:

```json
{
  "success": true,
  "tripId": "trip-001",
  "tripStatus": "TRIP_DONE",
  "message": "운행을 종료했습니다.",
  "timestamp": "2026-07-01T14:40:00+09:00"
}
```

상태 코드: `200`, `400`, `404`, `409`

## POST /api/ble/detections (검토중 초안)

> 미구현. 중간평가 이후 확장 API이며, 정민(ESP32 스마트지팡이) 검토 전 백엔드 초안이다.
> 필드명·타입은 정민의 실제 BLE Scan 송신 데이터에 맞춰 바뀔 수 있다.

- 기능 이름: 스마트지팡이 비콘 감지 결과 저장
- HTTP 메서드: `POST`
- 요청 주소: `/api/ble/detections`
- 프론트엔드/하드웨어 사용 위치: 스마트지팡이 ESP32가 targetBeaconId 감지 시 앱을 거쳐 전송

요청 Body(초안):

```json
{
  "tripId": "trip-001",
  "detectionId": "det-001",
  "targetBeaconId": "MOCK_BUS_1551_001",
  "rssi": -62,
  "proximity": "NEAR",
  "detectedAt": "2026-07-16T14:32:00+09:00",
  "isMock": true
}
```

- `detectionId`는 앱 또는 ESP32가 생성하는 멱등 키다. 같은 `detectionId` 재전송 시 새 행을 만들지 않고 기존 결과를 반환한다(`bell/result`의 재전송 처리 방식과 동일 원칙).
- `proximity`는 `docs/DB_SCHEMA.md`·노션 최종 흐름의 RSSI 단계(약함/중간/강함)를 코드값으로 표현한 것으로, 실제 열거값은 정민과 확정한다.
- 저장 테이블(안): `ble_logs` — `trip_id`, `detection_id`, `target_beacon_id`, `rssi`, `proximity`, `detected_at`, `is_mock`.

필수 필드(안): `tripId`, `detectionId`, `targetBeaconId`, `rssi`, `detectedAt`

상태 코드(안): `201`, `400`, `404`

## POST /api/vibration/logs (검토중 초안)

> 미구현. 중간평가 이후 확장 API이며, 정민(ESP32 스마트지팡이) 검토 전 백엔드 초안이다.

- 기능 이름: 스마트지팡이 진동 작동 로그 저장
- HTTP 메서드: `POST`
- 요청 주소: `/api/vibration/logs`
- 프론트엔드/하드웨어 사용 위치: 스마트지팡이 ESP32가 진동 모터 작동 시 앱을 거쳐 전송

요청 Body(초안):

```json
{
  "tripId": "trip-001",
  "logId": "vib-001",
  "vibrationLevel": "STRONG",
  "rssi": -50,
  "triggeredAt": "2026-07-16T14:32:05+09:00",
  "isMock": true
}
```

- `logId`는 `detectionId`와 같은 원칙의 멱등 키다.
- `vibrationLevel`은 약한/중간/강한 3단계(노션 최종 흐름 16번 단계) 코드값이며 실제 열거값은 정민과 확정한다.
- 저장 테이블(안): `vibration_logs` — `trip_id`, `log_id`, `vibration_level`, `rssi`, `triggered_at`, `is_mock`.

필수 필드(안): `tripId`, `logId`, `vibrationLevel`, `triggeredAt`

상태 코드(안): `201`, `400`, `404`

## 주요 오류 코드

```text
INVALID_REQUEST
DESTINATION_REQUIRED
INVALID_COORDINATES
GEOCODING_FAILED
BUS_API_ERROR
NO_NEARBY_STATION          현재 문서 기준 미사용, 구 GBIS 주변 정류소 조회 오류
NO_ROUTE_CANDIDATE
NO_DIRECT_BUS_CANDIDATE
ARRIVAL_INFO_NOT_FOUND
AI_GUIDE_ERROR
TRIP_NOT_FOUND
INVALID_TRIP_STATUS
INVALID_STATION_LIST
BEACON_NOT_FOUND
DB_ERROR
BELL_RESULT_ERROR
```

노선 후보가 없거나 직행 후보가 없는 상황은 서비스 오류가 아니라 정상 검색 결과일 수 있습니다. 이 경우 `success: true`, `routes: []`, 안내용 `guideMessage`를 반환하는 방식을 우선합니다.

## 구현 전 확인 필요

- `POST /api/trips`에서 직전 검색 결과를 서버 메모리, DB, 캐시 중 어디에 보관해 후보 위변조를 검증할지 확인 필요
- `bellStatus = FAIL` 이후 자동 재시도 허용 여부와 최대 재시도 횟수 확인 필요. 이 결정은 `POST /api/ble/detections`, `POST /api/vibration/logs` 초안의 멱등 키·append-only 여부 설계에도 그대로 적용된다.
- `targetBeaconId`를 `routeNo`만으로 조회할지, 최종적으로 `localBusId` 또는 `vehicleId` 기반으로 바꿀지 확인 필요
- `POST /api/ble/detections`, `POST /api/vibration/logs`의 `proximity`/`vibrationLevel` 열거값과 요청 필드는 정민의 실제 ESP32 송신 데이터 확정 후 검토 필요
- 앱 공개 응답 필드명을 `routes`로 유지할지 `candidates`로 변경할지 팀 합의 필요. 현재 문서는 기존 프론트 흐름을 고려해 `routes`를 유지하되 내부 객체는 효린 `candidates` 형식을 따릅니다.
