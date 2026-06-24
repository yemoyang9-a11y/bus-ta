# 데이터베이스 스키마

> Supabase(PostgreSQL) 기반. 마이그레이션 파일: `supabase/migrations/`

## trips

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | tripId |
| route_id | text | 노선 ID |
| boarding_station_id | text | 탑승 정류장 |
| alighting_station_id | text | 하차 목적 정류장 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## trip_status

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| trip_id | uuid FK(trips) | |
| status | text | TripStatus enum |
| remaining_stops | int | 남은 정류장 수 |
| recorded_at | timestamptz | |

## bell_logs

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| trip_id | uuid FK(trips) | |
| bell_request_id | text | bellRequestId |
| status | text | BellStatus enum |
| fail_reason | text nullable | |
| requested_at | timestamptz | |
| responded_at | timestamptz nullable | |

## bus_beacons

| 컬럼 | 타입 | 설명 |
|---|---|---|
| beacon_id | text PK | BUSTA-{노선}-{정류장} |
| route_id | text | |
| current_station_id | text nullable | |
| route_no | text | |
| last_seen_at | timestamptz nullable | |

## location_logs

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| trip_id | uuid FK(trips) | |
| request_id | text UNIQUE | 중복 방지 |
| lat | float8 | |
| lng | float8 | |
| accuracy | float8 nullable | |
| recorded_at | timestamptz | |

## system_logs

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| level | text | info/warn/error |
| message | text | |
| context | jsonb nullable | |
| recorded_at | timestamptz | |
