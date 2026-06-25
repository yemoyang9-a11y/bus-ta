# Codex 작업 규칙

이 문서는 Codex가 이 저장소에서 작업할 때 반드시 따라야 하는 규칙입니다.

## 기본 원칙

- 작업 전 `README.md`, `docs/` 하위 문서, `.env.example`을 먼저 확인한다.
- 기존 프로젝트 구조를 먼저 분석한 뒤 수정한다.
- 사용자 요청 범위 밖의 파일을 임의로 수정하지 않는다.
- 기존 기능과 문서 규칙을 임의로 삭제하지 않는다.
- 대규모 리팩터링은 사용자의 명시적인 요청이 있을 때만 수행한다.
- 문서 동기화 작업에서는 소스 코드, 패키지 설정, DB 마이그레이션 파일을 수정하지 않는다.
- 커밋과 푸시는 사용자가 명시적으로 요청한 경우에만 수행한다.

## 문서 우선순위

문서 내용이 충돌하면 다음 순서를 따른다.

1. 사용자가 현재 요청에 명시한 최종 확정 규칙
2. Notion 문서 상단의 2026-06-25 최신 개정 내용
3. `docs/PROJECT_OVERVIEW.md`
4. `docs/API_SPEC.md`
5. 백엔드 기능명세서에 해당하는 `docs/MODULE_CONTRACTS.md`
6. 나머지 문서

충돌을 임의로 숨기지 말고 최종 보고에 남긴다.

## API 및 데이터 규칙

- API 변경 시 `docs/API_SPEC.md`도 함께 수정한다.
- DB 필드가 바뀌면 `docs/DB_SCHEMA.md`도 함께 수정한다.
- 프론트엔드와 백엔드에서 사용하는 필드 이름은 일치시킨다.
- 공개 API와 앱 계약의 JSON 필드 이름은 `camelCase`를 사용한다.
- DB 컬럼은 같은 의미의 `snake_case`를 사용한다.
- ODsay 경로 유형 값은 효린 모듈 내부 처리 용도로만 허용한다.
- ODsay 내부 경로 유형 값은 프론트엔드 요청·응답, 백엔드 공개 API, DB 컬럼, trip 생성 요청, 공통 데이터 계약에 포함하지 않는다.

## 최신 API 흐름 규칙

- 경로 검색은 `POST /api/routes/search`를 사용한다.
- 운행 생성은 `POST /api/trips`를 사용한다.
- 위치 업데이트는 `PATCH /api/trips/{tripId}/status`를 사용한다.
- 상태 조회는 `GET /api/trips/{tripId}/status`를 사용한다.
- 하차벨 결과 저장은 `POST /api/trips/{tripId}/bell/result`를 사용한다.
- 별도 공개 도착정보 API는 만들지 않는다. 도착정보 조회는 `POST /api/trips` 내부에서 `getArrivalInfo(selectedCandidate)`로 처리한다.
- 앱의 별도 하차벨 시작 요청 API는 공개 API 목록에 두지 않는다. 백엔드가 `remainingStations = 1`을 감지할 때 `bellRequestId`와 `STOP_REQUEST`를 생성한다.
- 중간평가 API에서는 `routeId`, `stationId`, `routeDirection`, `endStationName` 대신 `candidateId`, `routeNo`, `localBusId`, `gbisStationId`, `stationName`과 좌표를 기준으로 한다.

## 하차벨 규칙

- `remainingStations = 2`: 사전 안내만 제공하고 `shouldTriggerBell = false`.
- `remainingStations = 1`이고 `bellStatus = NOT_REQUESTED`: 백엔드가 `bellRequestId`와 `STOP_REQUEST`를 생성하고 `bellStatus = PENDING`, `shouldTriggerBell = true`.
- `bellStatus = PENDING` 또는 `SUCCESS`: `shouldTriggerBell = false`.
- 하차벨 처리 상태는 `bellStatus`로 관리한다.
- 구버전 하차벨 boolean 필드는 사용하지 않는다.

## 환경변수와 보안

- 환경변수와 API 키를 코드에 직접 작성하지 않는다.
- 실제 `.env` 파일은 GitHub에 올리지 않는다.
- `.env.example`에는 실제 값 없이 필요한 환경변수 이름만 작성한다.
- 필수 외부 API 키 이름은 `KAKAO_REST_API_KEY`, `ODSAY_API_KEY`, `GBIS_SERVICE_KEY`, `OPENAI_API_KEY`를 기준으로 한다.
- 로그에 API 키, 토큰, 비밀번호, 민감한 위치 정보를 출력하지 않는다.

## 테스트와 보고

- 실행하지 않은 테스트를 성공했다고 작성하지 않는다.
- 테스트를 실행하지 못한 경우 그 이유를 명확히 보고한다.
- 작업 후 다음 내용을 보고한다.
  - 수정 파일
  - 구현 또는 작성 내용
  - 함께 수정한 문서
  - 실행한 테스트 또는 검증 명령
  - 테스트 또는 검증 결과
  - 남은 문제
  - 추가 확인이 필요한 항목

## 문서 관리

- 같은 목적의 문서를 중복 생성하지 않는다.
- `README.md`는 프로젝트 진입점 역할을 한다.
- 중간평가 범위는 `docs/MIDTERM_SCOPE.md`에 작성한다.
- API 상세 명세는 `docs/API_SPEC.md`에 작성한다.
- DB 구조는 `docs/DB_SCHEMA.md`에 작성한다.
- 모듈 간 계약은 `docs/MODULE_CONTRACTS.md`에 작성한다.
- 개발 규칙은 `docs/DEVELOPMENT_RULES.md`에 작성한다.
- 오류 기록은 `docs/TROUBLESHOOTING.md`에 누적한다.
