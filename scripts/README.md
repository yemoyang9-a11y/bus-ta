# scripts/

개발 및 시연 보조 스크립트 위치.

## 현재 검증 스크립트

| 파일 | 용도 |
|---|---|
| `verify-supabase-security.mjs` | 보안 기준 migration 이후의 `public` 함수 하드닝과 Data API 기본 권한 차단 여부 검증 |
| `verify-supabase-security.test.mjs` | 검증기의 회귀 테스트와 저장소 migration 세트 통합 검증 |

실행 명령은 각각 `pnpm verify:supabase-security`, `pnpm test:supabase-security`다.

## 예정 스크립트

| 파일 | 용도 |
|---|---|
| `seed-demo-data.ts` | Supabase에 시연용 초기 데이터 삽입 |
| `run-demo-sequence.ts` | mock 좌표 시퀀스를 서버로 자동 전송 (시연 리허설용) |
| `check-api.ts` | 서버 API 엔드포인트 헬스체크 |

스크립트 추가 시 `package.json` scripts에 등록한다.
