# scripts/

개발 및 시연 보조 스크립트 위치.

## 실행 환경과 품질 검사

저장소 루트에서 Node >=22.13.0, `pnpm@11.7.0`을 사용한다. CI는 Node22.17.0이다.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @bus-ta/server test
pnpm test:scripts
pnpm test:cane
```

`lint`는 JS/JSX/TS 구문과 오류 중심 규칙을 검사한다. TS 이름·타입 검사는 별도 `pnpm typecheck`가 담당하며 workspace와 `scripts/**/*.ts`를 모두 검사한다. scripts만 검사하려면 `pnpm typecheck:scripts`를 사용한다. `test:scripts`는 이 폴더의 모든 `*.test.mjs`와 `*.test.ts`를 서버의 tsx로 실행한다. 모바일 BLE·탑승 판정·Realtime 큐/완료/후보 안내·공통 계약과 설정 회귀를 포함하며 실기기 검증을 대신하지 않는다.

`build`의 서버 진입 산출물은 `apps/server/dist/apps/server/src/index.js`다. 공유 패키지의 TS 참조가 남으므로 독립 배포 번들로 간주하지 않는다. 서버 실행은 기존 `pnpm --filter @bus-ta/server start`(tsx)를 사용한다.

scripts 타입 검사는 `tsconfig.scripts.json`으로 tsx의 혼합 import 경로와 Node/DOM 타입을 해석한다. 이미 설치하는 서버의 `@types/node`를 사용한다. 가져오는 모바일 소스의 기존 Expo 타입 정책과 맞추기 위해 이 설정만 `exactOptionalPropertyTypes: false`이며, strict 검사와 미정의 이름 검사는 유지한다.

## 현재 검증 스크립트

| 파일 | 용도 |
|---|---|
| `verify-supabase-security.mjs` | 보안 기준 migration 이후의 `public` 함수 하드닝과 Data API 기본 권한 차단 여부 검증 |
| `verify-supabase-security.test.mjs` | 검증기의 회귀 테스트와 저장소 migration 세트 통합 검증 |
| `verify-render-config.test.mjs` | Render 설정과 서버 실행 계약 |
| `test-cane-feedback.mjs` | C++ 호스트에서 지팡이 PWM·표본·명령/Notify 경합 및 MTU/구독 회귀 |
| `test-supabase-boarding.sh` | 빈 로컬 PostgreSQL에 migration 적용, 탑승 SQL 및 legacy 사전조건 검증 |
| `test-bell-result-sql.mjs` | 실제 SQL rollback·권한·재시도와 별도 세션 4개 경합 시나리오 |

실행 명령은 각각 `pnpm verify:supabase-security`, `pnpm test:supabase-security`다.

지팡이 호스트 시험은 g++/clang++/Zig 중 설치된 C++ 컴파일러를 자동 탐지한다. `CXX`로 지정할 수도 있다. ESP32 빌드·업로드 및 실제 모터/BLE 시험은 [펌웨어 README](../hardware/smart-cane/README.md)를 따른다. 호스트 PASS는 실물 성공을 뜻하지 않는다.

## 격리 PostgreSQL 검사

**폐기 가능한 빈 로컬 PostgreSQL 15 전용 인스턴스**에서만 실행한다. 첫 스크립트는 `postgres` DB에 전체 migration을 적용하고 `boarding_confirmation_legacy_preflight` DB를 생성/교체한다. 운영 DB에 실행하지 않는다. psql/createdb/dropdb와 Bash가 필요하다.

```sh
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres
bash scripts/test-supabase-boarding.sh
node scripts/test-bell-result-sql.mjs
```

CI의 fresh `service_role`은 Supabase와 같이 `NOLOGIN BYPASSRLS`로 만든다. 기존 역할을 수정하지 않으므로 재사용 fixture는 속성을 별도로 확인한다. bell runner는 모든 migration이 적용된 뒤 실행하며 로컬 호스트만 허용한다. Windows에서는 `PSQL_BIN`을 `psql.exe` 경로로 지정할 수 있다. bell fixture는 검사 후 제거한다.

CI는 위 lint/typecheck/build, 서버·boarding·전체 scripts·C++ 시험을 실행하고, 별도 PostgreSQL 서비스에서 boarding 및 bell SQL을 실행한다. 실제 ESP32 빌드/무선 연결, 모바일 번들·실기기, 배포된 외부 API 검증은 별도다.

## 예정 스크립트

| 파일 | 용도 |
|---|---|
| `seed-demo-data.ts` | Supabase에 시연용 초기 데이터 삽입 |
| `run-demo-sequence.ts` | mock 좌표 시퀀스를 서버로 자동 전송 (시연 리허설용) |
| `check-api.ts` | 서버 API 엔드포인트 헬스체크 |

스크립트 추가 시 `package.json` scripts에 등록한다.
