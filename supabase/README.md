# Supabase

스키마 상세는 [`docs/database/schema.md`](../docs/database/schema.md) 참고.

## 테이블 목록

| 테이블 | 역할 | 접근 레이어 |
|---|---|---|
| `trips` | 이동 정보 | `trip.repository.ts` |
| `trip_status` | 이동 상태 이력 | `trip.repository.ts` |
| `bell_logs` | 하차벨 요청/결과 로그 | `bell.repository.ts` |
| `bus_beacons` | 버스 비콘 등록 정보 | `beacon.repository.ts` |
| `location_logs` | 위치 업데이트 로그 | `location.repository.ts` |
| `system_logs` | 시스템 이벤트 로그 | `system-log.repository.ts` |

## 마이그레이션

`supabase/migrations/` 에 SQL 파일을 순서대로 추가한다.  
실제 Supabase CLI 연동은 별도 설정 후 진행.
