# 개발 규칙 및 협업 컨벤션

> 문서 상태: 최종 개발 기준. API 상세와 데이터 상태는 각각 [API_SPEC.md](API_SPEC.md), [DB_SCHEMA.md](DB_SCHEMA.md)를 따른다.

## 브랜치와 PR

- 각 담당자는 자신의 개발 브랜치에서 한 가지 목적의 변경만 작업한다.
- PR base는 반드시 `claude/nice-archimedes-iv7iu0`이다. `claude` 브랜치에 직접 push하지 않는다.
- 작업 시작과 PR 생성 전 `claude` 최신 상태와 변경 파일을 확인한다.
- 관련 없는 포맷 변경, 개인 설정, 임시 파일, 실제 키·토큰·위치 정보는 포함하지 않는다.

## 계약 변경 절차

1. 변경 목적과 앱·서버·AI Dispatcher·하드웨어 소비자를 식별한다.
2. Notion의 공통 API/Function 문서와 공통 데이터/상태 문서를 기준으로 공개 필드·타입·enum·오류를 정한다.
3. `packages/shared` 타입·상수·Zod 스키마를 먼저 맞춘다.
4. 서버, 앱, Dispatcher, DB migration과 테스트를 계약에 맞게 수정한다.
5. GitHub `docs/`와 Notion 문서를 같은 변경 단위로 동기화한다.
6. PR에 코드 병합 상태와 실제 Supabase 적용 상태를 분리해 기록한다.

## 문서 동기화

| 변경 | 필수 동기화 |
| --- | --- |
| API 경로·요청·응답·오류 | shared, 서버·앱, 테스트, `docs/API_SPEC.md`, Notion 공통 API 명세 |
| 필드·enum·상태 전이 | shared, 서버·앱, DB 제약, `docs/DB_SCHEMA.md`, Notion 공통 데이터 명세 |
| Function·Dispatcher 변환 | API 명세, `FRONTEND_GUIDE.md`, `REALTIME_GUIDE.md` |
| 역할·이벤트 흐름 | `PROJECT_OVERVIEW.md`, 관련 API·상태 문서 |
| 신규 환경 변수 | `.env.example`, 서버 검증, API 명세 |

문서만 바꾸는 작업은 코드·패키지 설정·migration을 같이 바꾸지 않는다. 코드와 문서가 다르면 조용히 한쪽을 변경하지 말고, 실제 동작과 목표 계약 및 영향 범위를 PR 또는 이슈에 남긴다.

## Realtime 보안 환경변수

- 서버는 `OPENAI_API_KEY`와 `REALTIME_SHARED_SECRET`이 모두 설정된 경우에만 `POST /api/realtime/session`에서 단기 키를 발급한다.
- `REALTIME_SHARED_SECRET`이 비어 있으면 인증 실패가 아니라 서버 설정 오류로 보고 세션 발급을 거부한다.
- 모바일은 `EXPO_PUBLIC_` 접두사로 공유 비밀을 노출하지 않는다. EAS 또는 로컬 빌드 환경의 `REALTIME_SHARED_SECRET`을 Expo config `extra`를 통해 런타임에서 읽어 요청 헤더 `x-realtime-shared-secret`로 전달한다.
- 실제 공유 비밀, OpenAI API 키, 단기 키는 코드·문서·로그·PR 설명에 기록하지 않는다.

## 검증과 DB

- 실행한 검증만 통과로 기록한다. 실행하지 못한 항목은 사유와 남은 검증을 기록한다.
- API는 정상·입력 오류·없는 리소스·중복 요청을, 상태는 종료 운행과 하차벨 중복을 검증한다.
- migration 작성됨, 실제 DB 적용됨, RPC 확인됨, API-DB 통합 검증 완료는 별도 상태다.
- API 키·토큰·비밀번호·실제 위치 정보는 코드, 문서, 커밋 메시지와 PR 설명에 기록하지 않는다.

## 충돌 처리와 완료 보고

현재 구현 사실은 `claude` 코드·shared 타입·테스트·실제 DB 상태로, 합의된 목표는 최신 Notion 공통 계약으로 판단한다. 충돌 시 파일·브랜치·DB 상태, 실제 동작, 목표 계약, 영향과 수정·검증 계획을 남긴다.

완료 보고에는 변경 파일, 변경 목적, API·DB·shared 영향, 검증 명령·결과, migration 상태, Notion 동기화, 남은 위험을 포함한다.
