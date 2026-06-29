# 시연 전 점검 체크리스트

## 환경 준비

- [ ] `apps/server/.env` 파일 생성, `.env.example` 참고
- [ ] `apps/mobile/.env` 파일 생성
- [ ] `pnpm install` 완료
- [ ] `GET /api/health`가 200 OK를 반환하는지 확인

## 데이터 확인

- [ ] `packages/shared/src/fixtures/demo-route.ts` 정류장 좌표 확인
- [ ] `packages/shared/src/fixtures/demo-locations.ts` mock 좌표 시퀀스 확인
- [ ] `packages/shared/src/fixtures/demo-beacon.ts` 비콘 ID 확인

## 시연 흐름 리허설

- [ ] `POST /api/trips` 후 `tripId` 수신 확인
- [ ] `PATCH /api/trips/{tripId}/status` 반복 호출로 `tripStatus` 전환 확인
- [ ] 남은 정류장 1개 시점에 `shouldTriggerBell: true`, `bellRequestId`, `command: STOP_REQUEST` 확인
- [ ] `POST /api/trips/{tripId}/bell/result` 후 `bellStatus: SUCCESS` 또는 `FAIL` 확인
- [ ] 전체 흐름을 1회 이상 통과 확인

## 시연 당일

- [ ] 발표 전 서버 재시작 및 상태 확인
- [ ] 네트워크 연결 상태 확인
- [ ] 예비 mock 데이터와 설명 자료 준비
