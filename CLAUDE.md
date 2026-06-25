# Claude Code 작업 지침

이 파일은 Claude Code가 이 저장소에서 작업할 때 따라야 할 프로젝트 지침입니다. 프로젝트 내용을 이 파일에 중복해서 작성하지 말고, 아래 문서를 먼저 확인한 뒤 작업합니다.

## 반드시 참고할 문서

- `README.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/MIDTERM_SCOPE.md`
- `docs/ARCHITECTURE.md`
- `docs/API_SPEC.md`
- `docs/DB_SCHEMA.md`
- `docs/DEVELOPMENT_RULES.md`
- `docs/MODULE_CONTRACTS.md`
- `docs/DEMO_SCENARIO.md`
- `docs/TROUBLESHOOTING.md`
- `.env.example`

기존 모노레포 세부 문서가 필요한 경우 다음 문서도 함께 확인한다.

- `docs/project-context.md`
- `docs/repository-structure.md`
- `docs/api/api-spec.md`
- `docs/architecture/data-flow.md`
- `docs/architecture/system-overview.md`
- `docs/database/schema.md`
- `docs/demo-scenario/call-order.md`

## 프로젝트 문서 우선 원칙

- Claude Code는 코드 작업을 시작하기 전에 `README.md`와 관련 `docs` 문서를 먼저 확인한다.
- 작업 요청과 관련된 문서를 직접 읽은 뒤 현재 코드 구조를 분석한다.
- 문서에 정의된 프로젝트 목적, API 명세, 아키텍처와 개발 규칙을 우선 기준으로 사용한다.
- 문서와 실제 코드가 다르면 임의로 한쪽을 선택하지 않고 차이점을 확인한다.

## 작업 범위 규칙

- 요청받은 범위 안에서만 수정한다.
- 기존 기능을 임의로 삭제하지 않는다.
- 요청받지 않은 대규모 리팩터링을 하지 않는다.
- 관련 없는 파일을 불필요하게 수정하지 않는다.
- 문서에 없는 기능이나 구조를 임의로 추가하지 않는다.
- 기존 프로젝트의 폴더 구조와 코딩 방식을 먼저 파악한다.

## 모노레포 구조 및 단일 출처

현재 브랜치는 pnpm 워크스페이스 기반 모노레포 구조를 사용한다.

```text
apps/mobile       Expo 앱
apps/server       Express 서버
packages/shared   공유 타입, 상수, 스키마, fixture
hardware/         ESP32 펌웨어 및 하드웨어 자료
docs/             설계, API, 시연 문서
supabase/         DB 마이그레이션
```

- API 경로는 `packages/shared/src/constants/api-paths.ts`를 단일 출처로 사용한다.
- 상태값은 `packages/shared/src/constants/trip-status.ts`, `packages/shared/src/constants/bell-status.ts`와 문서 명세를 함께 확인한다.
- 시연 데이터는 가능하면 `packages/shared/src/fixtures/`를 기준으로 관리한다.
- 프론트엔드와 백엔드의 타입, Zod 스키마, 상수가 어긋나지 않도록 `packages/shared`를 먼저 확인한다.

## 문서 동기화 규칙

- API 요청 또는 응답 구조를 변경하면 `docs/API_SPEC.md`를 함께 수정한다.
- DB 필드를 변경하면 `docs/DB_SCHEMA.md`를 함께 수정한다.
- 시스템 구조가 바뀌면 `docs/ARCHITECTURE.md`를 함께 수정한다.
- 개발 규칙이 바뀌면 `docs/DEVELOPMENT_RULES.md`를 함께 수정한다.
- 모듈 간 입력·출력 계약이 바뀌면 `docs/MODULE_CONTRACTS.md`를 함께 수정한다.
- 새로운 환경변수가 필요하면 `.env.example`에 변수 이름만 추가한다.
- 오류 원인과 해결 방법이 팀 전체에 도움이 되면 `docs/TROUBLESHOOTING.md`에 기록한다.
- 아직 구현되지 않은 기능을 완료로 표시하지 않는다.

## API 연동 규칙

- 프론트엔드와 백엔드의 API 필드 이름을 일치시킨다.
- API 필드 이름은 `docs/API_SPEC.md`를 기준으로 한다.
- DB 컬럼명은 `docs/DB_SCHEMA.md`를 기준으로 한다.
- 기존 명세와 코드가 다르면 바로 변경하지 말고 불일치 내용을 확인한다.
- API 필드 이름은 `camelCase`를 사용한다.
- 공개 API와 DB에는 ODsay 내부 경로 유형 값을 포함하지 않는다.
- `GET /api/trips/{tripId}/bell`, `POST /api/ble/result`, `POST /api/trips/{tripId}/bell/request`는 공개 MVP 흐름에서 사용하지 않는다.
- 위치 업데이트는 `PATCH /api/trips/{tripId}/status`를 사용한다.
- `GET /api/trips/{tripId}/status`는 조회 전용이며 상태를 변경하지 않는다.
- `remainingStations = 1`이고 `bellStatus = NOT_REQUESTED`이면 백엔드가 `PATCH /api/trips/{tripId}/status` 처리 중 `bellRequestId`와 `STOP_REQUEST`를 자동 생성하고 `bellStatus = PENDING`으로 변경한다.
- 하차벨 결과는 `POST /api/trips/{tripId}/bell/result`에서 같은 `bellRequestId`로 받아 `PENDING -> SUCCESS/FAIL`로 처리한다.
- `requestId`는 GPS/mock 위치 업데이트 멱등성 식별자이고, `bellRequestId`는 하차벨 요청과 결과 연결 식별자이다. 두 값을 혼용하지 않는다.
- 하차 안내 관련 응답에서는 다음 필드를 확인한다.
  - `tripStatus`
  - `guideMessage`
  - `remainingStations`
  - `currentStation`
  - `nextStation`
  - `destinationStation`
  - `shouldTriggerBell`
  - `bellStatus`
  - `bellRequestId`
  - `command`

## Mock 책임 구분

- 시연 데이터 단일 출처: `packages/shared/src/fixtures/`
- mock 좌표 전송 순서 제어: `apps/mobile/src/demo/`
- 정류장 계산: `apps/server/src/services/trip/`
- mock 하차벨 결과 생성: `apps/server/src/adapters/bell/mock-bell.adapter.ts`

## 브랜치 및 PR 규칙

- `main` 브랜치 직접 push는 피한다.
- 기능별 브랜치 또는 작업 브랜치에서 커밋한 뒤 Pull Request로 병합한다.
- PR 전 `.github/pull_request_template.md` 체크리스트와 관련 문서를 확인한다.

## 보안 규칙

- API 키, 토큰, 비밀번호를 코드에 직접 작성하지 않는다.
- 실제 `.env` 파일이나 비밀정보를 GitHub에 추가하지 않는다.
- 환경변수 예시는 `.env.example`에 값 없이 작성한다.
- 로그에 민감한 정보를 출력하지 않는다.

## 테스트 및 완료 기준

- 수정한 기능과 직접 관련된 테스트 또는 실행 확인을 수행한다.
- 실행하지 않은 테스트를 통과했다고 말하지 않는다.
- 확인하지 못한 부분은 명확하게 표시한다.
- 작업 완료 후 다음 내용을 요약한다.
  1. 변경한 내용
  2. 수정한 파일
  3. 함께 수정한 문서
  4. 실행한 테스트 또는 명령어
  5. 테스트 결과
  6. 확인하지 못한 부분
  7. 남아 있는 문제

## 프로젝트 주요 흐름

```text
사용자 음성 입력
-> React Native 앱
-> Node.js 백엔드
-> 카카오 로컬 API
-> ODsay API
-> 후보 경로 검증
-> OpenAI API가 최종 후보 2개 선택
-> 경로와 버스 정보 반환
-> 버스 이동 상태 추적
-> 하차 정류장 접근 판단
-> TTS 안내
-> BLE 또는 mock 하차벨
-> ESP32 진동 또는 하차벨 신호
```

## 문서 선택 기준

모든 작업에서 모든 문서를 무조건 읽도록 강제하지 말고, 작업 범위에 따라 관련 문서를 선택해 읽는다.

- 프로젝트 전체 이해: `README.md`, `docs/PROJECT_OVERVIEW.md`
- 중간평가 범위: `docs/MIDTERM_SCOPE.md`
- 프론트엔드와 백엔드 연동: `docs/API_SPEC.md`
- DB 변경: `docs/DB_SCHEMA.md`
- 구조 변경: `docs/ARCHITECTURE.md`
- 코드 작성 및 보안: `docs/DEVELOPMENT_RULES.md`
- 모듈 간 계약: `docs/MODULE_CONTRACTS.md`
- 시연 준비: `docs/DEMO_SCENARIO.md`
- 브랜치, 커밋, PR: `CONTRIBUTING.md`
- 기존 오류 확인: `docs/TROUBLESHOOTING.md`
