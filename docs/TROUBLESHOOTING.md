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

## POST /api/routes/search 가 502 인데 원인을 어디에서도 알 수 없음

- 발생 날짜: 2026-08-07
- 담당자: 예모
- 발생 환경: Render `bus-ta` 운영 (`claude/nice-archimedes-iv7iu0` 배포 후)
- 증상: `POST /api/routes/search` 가 `502 ROUTE_SEARCH_FAILED` 를 돌려주는데,
  Kakao 때문인지 ODsay 때문인지, 상태 코드가 무엇이었는지 알 수 없다.
  Render 로그를 아무리 뒤져도 `AxiosError` 가 나오지 않는다.
- 원인: 두 곳에서 실패 정보가 사라지고 있었다.
  1. `search-routes.service.ts` 의 `catch { ... }` 가 오류 객체를 바인딩조차 하지 않아
     AxiosError 가 그대로 소멸했다. 서버에는 요청 로거도 없어 흔적이 남지 않는다.
  2. `hyorin-route-search.adapter.ts` 의 ODsay 호출이 `if (!res.data.result) return []`
     이라, ODsay 가 인증 실패를 **HTTP 200 + error 본문**으로 돌려줘도
     "조건에 맞는 후보 없음"과 구분되지 않았다.
- 해결 방법: 실패 지점을 로그로 드러낸다. 공개 API 계약(502 / 200+빈 배열)은 바꾸지 않았다.
  - 외부 호출 실패는 `upstream`(`KAKAO`/`ODSAY`)과 HTTP 상태를 담은 오류로 감싼다.
  - 서비스는 502 로 응답하기 전에 `[routes/search] 외부 API 요청 실패 upstream=... status=... message=...` 를 남긴다.
  - ODsay 응답에 `result` 가 없으면 `[routes/search] ODSAY 응답에 result 가 없다 code=... message=...` 를 남긴다.
- 로그 읽는 법:
  - `upstream=KAKAO status=401` → Kakao 키가 무효하거나 `KAKAO_REST_API_KEY` 이름이 다르다.
  - `upstream=KAKAO status=429` → Kakao 쿼터·스로틀.
  - `message=[ApiKeyAuthFailed] ...` → `ODSAY_API_KEY` 문제. 후보 0건은 필터 탓이 아니다.
  - `upstream=UNKNOWN` 인데 `message=목적지를 찾을 수 없습니다: ...` → Kakao 는 정상이고 검색어가 없는 장소다.
- 주의: 오류 객체를 통째로 로그에 찍으면 안 된다. `AxiosError.config` 에 요청에 쓴 API 키가
  그대로 들어 있다. 그래서 원본 AxiosError 는 `cause` 로도 넘기지 않는다.
- 수정 파일: `apps/server/src/services/route/search-routes.service.ts`,
  `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts`
- 재발 방지 방법: 외부 API 호출을 새로 추가할 때 실패를 삼키지 않는다.
  `catch {}` 와 "오류를 빈 결과로 바꿔 반환"은 운영에서 진단을 불가능하게 만든다.
- 남은 문제: `getBusArrivalByStationId`(GBIS)는 아직 같은 처리가 되어 있지 않다.
  `predictedArrivalMinutes` 가 `null` 로 나올 때 원인을 여전히 알 수 없다.
