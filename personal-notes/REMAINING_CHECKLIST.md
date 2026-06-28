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

- [ ] 효린 `searchRoutes(destination, lat, lng)` 실모듈 → `routes/routes.ts` 의 `mockSearchRoutes` 주입 교체
- [ ] 효린 `getArrivalInfo(selectedCandidate)` → `create-trip.service` 연결, 실패 시 `predictedArrivalMinutes:null` 유지 재확인
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
