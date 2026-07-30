# 남은 작업 체크리스트

> 기준 커밋: `0c04a06` · 브랜치: `yemo-develop`
> 운영 방식: 작업을 끝내고 검증·푸시까지 완료하면 해당 항목의 `[ ]` 를 `[x]` 로 바꾸고
> 완료 커밋 해시를 끝에 적는다. 미완료 사유가 생기면 항목 아래에 한 줄로 메모한다.
> 새 작업이 생기면 알맞은 구역에 항목을 추가한다.

---

## A. 백엔드 코드

- [ ] PATCH `/api/trips/{tripId}` 운행 취소/재시작 (현재 501·문서 "미구현" 표기)
  - 보류 확정: 시연에 취소 장면 없음. 필요해지면 `action:"CANCEL"` 로 구현.

## B. 외부 모듈 연동 (자리는 마련됨, 차단요인 아님)

- [x] 효린 `searchRoutes(destination, lat, lng)` 실모듈 → `routes/routes.ts` 의 `mockSearchRoutes` 주입 교체 (`34f52d2`)
- [x] 효린 `getArrivalInfo(selectedCandidate)` → `create-trip.service` 연결, 실패 시 `predictedArrivalMinutes:null` 유지 재확인 (`34f52d2`)
- [ ] 유나 OpenAI 최종 후보 2개 선택 로직 → 현재 mock 2개 대체 중

## C. mock 데이터 값 통일 (보류 — 시연용 ODsay 노선 확정이 선행)

- [ ] 팀: 시연용 ODsay 노선 1개 확정 (수원대行) ← 선행 차단 의존성
- [ ] `demo-route.ts` 를 확정 노선 실제 데이터로 교체
- [ ] `demo-locations.ts` GPS열을 마지막-1 좌표 = 목적지 전 정류장(stationList[length-2]) 으로 역산
- [ ] `demo-beacon.ts` 비콘을 확정 노선에 맞춤
- [ ] 단위테스트로 "정확히 remainingStations=1 에서 벨 트리거" 고정
  - 규칙: ODsay 내부 경로유형 값은 공개 API/DB/fixture 에 넣지 않는다.

## D. 예모 범위 밖 (다른 팀원)

- [ ] ESP32 펌웨어 / `targetBeaconId` 실제 장비값
- [ ] RN 앱 화면 / STT / BLE 연동

## F. 견고성 백로그 (재검토 반영, 중간평가 이후)

- [ ] PATCH `/status` 와 POST `/bell/result` 의 다중 쓰기를 Supabase RPC/Postgres function 으로 묶어 **진짜 트랜잭션(원자성)** 보장
  - 현재는 저장 순서 조정 + bell/result 멱등 자가치유로 완화만 적용됨 (`54b7eb4`~).

## G. bus_beacons Supabase 연동 code-review 후속 (판단 불필요, 실행만 하면 됨)

> 판단이 필요한 항목은 여기 대신 `PENDING_DECISIONS.md`에 있다. 결정이 끝나야 착수 가능한 항목은
> 거기서 먼저 확정한 뒤 이 체크리스트로 옮긴다.

- [ ] `docs/API_SPEC.md`의 `GET /api/beacons?routeNo=` 상태 코드 목록(`200, 400, 404`)에 `500` 추가
  - 현재 서비스(`get-beacon.service.ts`)는 이미 500 DB_ERROR를 반환하지만 문서에 누락됨
- [ ] `supabase/migrations/20260716_seed_bus_beacons.sql`의 `on conflict (beacon_id) do nothing`을
      필요 시 `do update set ...`로 보강 검토 (기존 행이 fixture와 값이 어긋나 있어도 갱신되지 않는 문제)
- [ ] `apps/server/src/repositories/supabase/beacon.repository.ts`와 `trip.repository.ts`에 중복된
      `selectRows`/`headers()`/`readString`/`readNullableString`을 공통 모듈로 추출
      (다음 Supabase 레포지토리(`ble_logs`, `vibration_logs`)를 만들 때 세 번째 복붙을 막기 위함)
- [ ] `SupabaseBeaconRepository.findAll`/`findById` — 실사용처가 없으면 인터페이스에서 빼거나,
      실제로 쓸 곳(관리자 조회 등)이 생기면 그때 유지
  - code-review(2026-07-16)에서 발견: 테스트 외 호출처 0건
- [ ] 정민 ESP32가 실제 `BUS_{routeToken}_{vehicleToken}` 비콘을 방송하기 시작하면
      `bus_beacons`에 non-mock 행 추가 (현재는 `MOCK_BUS_1551_001` 1건만 시드됨)
  - 차단 요인: 정민 하드웨어 준비 상태

## E. 관리·검증

- [ ] 시연 전 Supabase 테스트 trip 데이터 정리 (선택)
- [ ] 시연 전체 흐름 1회 리허설 (health → routes/search → trips → status×N → 자동 벨 → bell/result → beacons)

---

## ✅ 완료 기록 (참고)

- 0~8단계 백엔드 API 구현 — 33 테스트 PASS
- 9단계 노선 검색 mock 골격 — `9bc136e`
- 실 Supabase end-to-end 검증 (3~7단계)
- `.env` 자동 로드 — `1389a33`
- 10단계 통합 점검 + dead code/스텁/문서 정리 — `ad070a6`, `ff045b2`, `a0db3a4`
- codex 인수인계 보고서 — `0c04a06`
