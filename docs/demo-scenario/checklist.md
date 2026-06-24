# 시연 전 점검 체크리스트

## 환경 준비
- [ ] `apps/server/.env` 파일 생성 (`.env.example` 참고)
- [ ] `apps/mobile/.env` 파일 생성
- [ ] `pnpm install` 완료
- [ ] `apps/server` 실행 확인 (`GET /api/health` → 200 OK)

## 데이터 확인
- [ ] `packages/shared/src/fixtures/demo-route.ts` 정류장 좌표 확인
- [ ] `packages/shared/src/fixtures/demo-locations.ts` mock 좌표 시퀀스 확인
- [ ] `packages/shared/src/fixtures/demo-beacon.ts` 비콘 ID 확인

## 시연 흐름 리허설
- [ ] `POST /api/trips` → tripId 정상 수신
- [ ] mock 좌표 전송 시 `tripStatus` 전환 확인
- [ ] `POST /api/trips/{tripId}/bell/request` → `bellStatus: PENDING` 확인
- [ ] mock-bell.adapter 결과 → `bellStatus: SUCCESS` 확인
- [ ] 전체 흐름 1회 통과 확인

## 시연 당일
- [ ] 발표 5분 전 서버 재기동 및 헬스체크
- [ ] 네트워크 연결 상태 확인 (앱 ↔ 서버)
- [ ] 예비 디바이스 준비 여부 확인
