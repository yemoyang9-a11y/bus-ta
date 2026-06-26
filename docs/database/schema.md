# DB 스키마

이 문서는 Supabase PostgreSQL 기준 MVP DB 스키마 초안입니다. 최신 기준은 2026-06-25 Notion 확정 내용과 효린 `routeSearch.js` 현재 명세입니다.

API 필드는 `camelCase`, DB 컬럼은 같은 의미의 `snake_case`를 사용합니다.

## 이름 규칙

- 앱·API: `camelCase`
- DB 컬럼: `snake_case`
- 예: `routeNo` ↔ `route_no`, `localBusId` ↔ `local_bus_id`
- 공개 API와 DB에는 ODsay 내부 경로 유형 값을 저장하지 않는다.
- 중간평가 정류장 객체에는 `stationId`를 사용하지 않는다.
- 사용자가 말한 목적지와 실제 하차 정류장 이름을 구분한다.

```text
destination
-> 사용자가 음성으로 입력한 목적지 이름

destination_station.stationName
-> 실제 버스 하차 정류장 이름
```

## 공통 정류장 JSON 구조

`boarding_station`, `destination_station`, `current_station`, `next_station`은 문자열이 아니라 다음 객체 형식으로 저장합니다.

```json
{
  "stationName": "오목천역.영신여자고교.청구아파트",
  "latitude": 37.242027,
  "longitude": 126.962801,
  "sequence": 0
}
```

규칙:

- ODsay `passStopList`에서 경유 정류장의 고유 `stationId`가 제공되지 않으므로 중간평가에서는 저장하지 않는다.
- `boarding_station`과 `destination_station`에는 `sequence`가 없어도 된다.
- `station_list`의 각 항목에는 `sequence`를 포함한다.
- `sequence`는 오름차순이어야 하지만 불연속일 수 있다.
- 남은 정류장 수는 `sequence` 차이가 아니라 `station_list` 배열 인덱스 기준으로 계산한다.

## trips

사용자가 선택한 운행 정보를 저장합니다.

```text
trip_id                      string      PK, 서버가 발급한 운행 ID
user_id                      string      nullable, 사용자 인증 전까지 임시값 또는 null
destination                  string      사용자가 입력한 목적지 텍스트
candidate_id                 integer     nullable, 효린 searchRoutes 후보 식별자
route_no                     string      사용자에게 표시할 노선 번호
local_bus_id                 string      ODsay busLocalBlID, GBIS routeId 형식
gbis_station_id              string      ODsay startLocalStationID, GBIS stationId
vehicle_id                   string      nullable, 실제 차량 연동 시 사용
boarding_station             json        탑승 정류장 객체
destination_station          json        목적지 인근 실제 하차 정류장 객체
station_list                 json        탑승부터 목적지까지의 정류장 객체 배열
total_time                   integer     nullable, ODsay 전체 소요시간
total_walk                   integer     nullable, 총 도보 거리
payment                      integer     nullable, 요금
bus_transit_count            integer     nullable, ODsay 기준 버스 구간 수
bus_station_count            integer     nullable, 버스 정류장 수
total_distance               integer     nullable, 전체 이동 거리
interval_time                integer     nullable, 배차 간격
predicted_arrival_minutes    integer     nullable, getArrivalInfo() 조회 결과
created_at                   datetime    ISO 8601 기준 생성 시각
updated_at                   datetime    마지막 수정 시각
```

초기 생성 규칙:

- `trip_status`는 `WAITING_BUS`로 생성한다.
- `bell_status`는 `NOT_REQUESTED`로 생성한다.
- `trip_id`는 요청에서 받지 않고 서버가 발급한다.
- `predicted_arrival_minutes`는 GBIS 조회 실패 시 `null`을 허용한다.
- 구버전 `route_id`, `route_direction`, `end_station_name`은 중간평가 기준 필수 컬럼으로 사용하지 않는다.

## trip_status

현재 이동 및 하차벨 상태를 저장합니다.

```text
status_id               string      PK
trip_id                 string      FK -> trips.trip_id, 운행당 1개 상태 행
current_station         json        nullable, 현재 정류장 객체
next_station            json        nullable, 다음 정류장 객체. 도착 시 null
remaining_stations      integer     남은 정류장 수, 최소 0
trip_status             string      WAITING_BUS | ON_BUS | NEAR_DESTINATION | TRIP_DONE | ERROR
bell_status             string      NOT_REQUESTED | PENDING | SUCCESS | FAIL
last_request_id         string      nullable, 최근 위치 업데이트 요청 식별자
location_source         string      nullable, GPS | MOCK | MANUAL
recorded_at             datetime    nullable, 실제 위치 측정 시각
updated_at              datetime    마지막 상태 갱신 시각
```

`should_trigger_bell`은 DB에 저장하지 않고 응답 시 계산합니다.

```text
remaining_stations = 1
AND bell_status = NOT_REQUESTED
-> PATCH /api/trips/{tripId}/status에서 하차벨 요청 자동 생성
-> shouldTriggerBell = true
-> bell_status = PENDING

그 외
-> shouldTriggerBell = false
```

## bell_logs

백엔드가 생성한 `STOP_REQUEST` 요청과 앱이 전달한 결과를 기록합니다.

```text
bell_log_id             string      PK
trip_id                 string      FK -> trips.trip_id
bell_request_id         string      하차벨 요청과 결과를 연결하는 식별자
command                 string      STOP_REQUEST
result                  string      nullable, SUCCESS | FAIL
is_mock                 boolean     mock 하차벨 여부
message                 string      nullable, 처리 결과 메시지
retry_count             integer     재시도 횟수, 기본값 0
requested_at            datetime    백엔드가 PATCH /status에서 STOP_REQUEST를 생성한 시각
completed_at            datetime    nullable, /bell/result 처리 시각
created_at              datetime    로그 생성 시각
```

규칙:

- `POST /api/trips/{tripId}/bell/request`는 사용하지 않는다.
- 백엔드가 `PATCH /api/trips/{tripId}/status`에서 `bell_request_id`와 요청 로그를 생성한다.
- `bell_status = PENDING`일 때만 새 결과를 정상 처리한다.
- 같은 `bell_request_id`의 결과 요청이 재전송되면 중복 로그를 만들지 않고 기존 결과를 반환한다.
- 하차벨 처리 결과는 `trip_status`가 아니라 `bell_status`로만 표현한다.

## bus_beacons

노선·차량과 비콘 ID를 매칭합니다.

```text
beacon_id               string      PK
route_no                string      노선 번호
local_bus_id            string      nullable, ODsay/GBIS 노선 식별자
vehicle_id              string      nullable, 실제 차량 식별자
target_beacon_id        string      앱이 스마트지팡이에 전달할 비콘 식별자
uuid                    string      nullable, BLE 서비스 또는 비콘 UUID
major                   integer     nullable
minor                   integer     nullable
status                  string      ACTIVE | INACTIVE
is_mock                 boolean     mock 비콘 여부
created_at              datetime    생성 시각
updated_at              datetime    수정 시각
```

비콘 ID 형식:

```text
실제·시제품: BUS_{routeToken}_{vehicleToken}
mock: MOCK_BUS_{routeToken}_{vehicleToken}
```

예:

```text
MOCK_BUS_7002_001
```

## location_logs

위치 업데이트 로그는 선택 테이블입니다.

```text
location_log_id         string      PK
trip_id                 string      FK -> trips.trip_id
request_id              string      trip_id와 함께 중복 요청 판정에 사용
latitude                number      현재 위도
longitude               number      현재 경도
source                  string      GPS | MOCK | MANUAL
recorded_at             datetime    위치 측정 시각
current_station         json        계산된 현재 정류장 객체
remaining_stations      integer     계산된 남은 정류장 수
location_accepted       boolean     위치 반영 여부
reason                  string      nullable, BACKWARD_STATION_IGNORED 등
created_at              datetime    저장 시각
```

권장 고유 조건:

```text
UNIQUE(trip_id, request_id)
```

## API와 DB 필드 매핑

```text
tripId                   <-> trip_id
candidateId              <-> candidate_id
routeNo                  <-> route_no
localBusId               <-> local_bus_id
gbisStationId            <-> gbis_station_id
vehicleId                <-> vehicle_id
boardingStation          <-> boarding_station
destinationStation       <-> destination_station
stationList              <-> station_list
predictedArrivalMinutes  <-> predicted_arrival_minutes
currentStation           <-> current_station
nextStation              <-> next_station
remainingStations        <-> remaining_stations
tripStatus               <-> trip_status
bellStatus               <-> bell_status
targetBeaconId           <-> target_beacon_id
requestId                <-> location_logs.request_id
bellRequestId            <-> bell_logs.bell_request_id
isMock                   <-> is_mock
```

## 테이블 관계

```text
trips 1 -- 1 trip_status
trips 1 -- N bell_logs
trips 1 -- N location_logs (선택)
trips.route_no / local_bus_id / vehicle_id -- bus_beacons.route_no / local_bus_id / vehicle_id
```

MVP에서는 `users` 테이블 없이 `user_id`를 null 또는 임시값으로 둘 수 있습니다.
