# 오류 해결 기록

이 문서는 팀 개발 중 발생한 오류와 해결 방법을 누적하기 위한 문서입니다. 같은 오류가 반복될 때 원인을 빠르게 찾을 수 있도록 기록합니다.

## 기록 규칙

- 팀 전체에 도움이 되는 오류만 기록합니다.
- 실제 원인을 모르면 `확인 필요`로 남깁니다.
- 임시 해결 방법과 최종 해결 방법을 구분합니다.
- 관련 커밋 또는 Pull Request가 있으면 함께 남깁니다.

## 오류 기록 양식

```md
## 오류 제목

- 발생 날짜:
- 담당자:
- 발생 환경:
- 증상:
- 원인:
- 해결 방법:
- 수정 파일:
- 재발 방지 방법:
- 관련 커밋 또는 Pull Request:
```

## 예시

```md
## BIS API 응답 지연으로 도착 정보 조회 실패

- 발생 날짜: 확인 필요
- 담당자: 확인 필요
- 발생 환경: 백엔드 개발 서버
- 증상: 도착 정보 조회 요청 후 응답 시간이 길어짐
- 원인: 외부 API 응답 지연 또는 네트워크 문제
- 해결 방법: 확인 필요
- 수정 파일: 확인 필요
- 재발 방지 방법: 타임아웃과 재시도 정책 추가 검토
- 관련 커밋 또는 Pull Request: 확인 필요
```

## GET /api/health 의 dbStatus 가 NOT_CONFIGURED 로 나옴

- 발생 날짜: 2026-06-27
- 담당자: 예모
- 발생 환경: 백엔드 로컬 개발 (apps/server)
- 증상: `apps/server/.env` 에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 를 넣었는데도
  `GET /api/health` 응답이 `dbStatus: "NOT_CONFIGURED"` 로 나온다.
- 원인: 서버가 `.env` 파일을 자동으로 읽지 않았다. `tsx watch src/index.ts` 와
  `node dist/index.js` 는 `.env` 를 자동 로드하지 않으므로 `process.env` 에 값이 들어가지 않았다.
- 임시 해결 방법: 서버를 실행하는 셸에서 환경변수를 직접 주입한 뒤 실행
  (`$env:SUPABASE_URL=...; $env:SUPABASE_SERVICE_ROLE_KEY=...; pnpm --filter @bus-ta/server dev`).
- 최종 해결 방법: `apps/server/src/index.ts` 시작 시 실행 디렉터리의 `.env` 를
  `process.loadEnvFile` 로 자동 로드한다. 파일이 없으면 건너뛰고, 셸에 이미 설정된 변수가 우선한다.
- 수정 파일: `apps/server/src/index.ts`
- 재발 방지 방법: `.env` 는 `.gitignore` 로 커밋 금지, 변수 이름은 `apps/server/.env.example` 에만 유지.
- 관련 커밋 또는 Pull Request: yemo-develop 브랜치 커밋

## Supabase Data API가 백엔드 외부에서 접근되지 않음

- 발생 날짜: 2026-08-04
- 담당자: 예모
- 발생 환경: Render `bus-ta` 및 로컬 백엔드
- 증상: 백엔드가 Supabase 테이블·RPC를 호출하지 못하거나 anon 키를 사용하는 것처럼 보인다.
- 원인: 백엔드는 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`만 사용한다. `SUPABASE_ANON_KEY`는 지원하지 않으며, 대상 테이블과 RPC는 anon/authenticated 역할에 공개하지 않는다.
- 해결 방법: `SUPABASE_URL`에는 `/rest/v1/`가 붙지 않은 프로젝트 기본 URL을 설정하고, `SUPABASE_SERVICE_ROLE_KEY`는 Render/server secret에만 설정한다. 모바일 앱과 `EXPO_PUBLIC_*` 환경변수에는 service-role 키를 넣지 않는다.
- 수정 파일: `apps/server/src/config/supabase.ts`, `.env.example`, `apps/server/.env.example`, `supabase/migrations/20260804112643_secure_data_api_access.sql`
- 재발 방지 방법: 배포 환경에 service-role 키 설정 여부를 확인하고, anon 키를 사용한 직접 Data API 접근과 Supabase security advisor 결과를 별도로 점검한다.
- 관련 커밋 또는 Pull Request: [PR #5](https://github.com/yemoyang9-a11y/bus-ta/pull/5)
