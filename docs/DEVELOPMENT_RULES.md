# 개발 규칙

이 문서는 팀 개발 중 코드, API, 환경변수, 테스트, 문서 관리 기준을 정리합니다.

## 폴더별 담당 범위

현재 브랜치는 pnpm 워크스페이스 기반 모노레포 구조를 사용합니다.

- `apps/mobile/`: React Native/Expo 앱 화면, STT/TTS, API 호출, BLE 연결
- `apps/server/`: Express 서버, API 라우트, 외부 API 연동, DB 저장, 상태 계산
- `packages/shared/`: 프론트엔드와 백엔드가 공유하는 타입, 상수, Zod 스키마, 시연 fixture
- `hardware/`: ESP32 펌웨어, BLE 비콘, 스마트지팡이, 하차벨 모형
- `supabase/`: DB 마이그레이션, Supabase 관련 자료
- `docs/`: 프로젝트 문서, API 명세, DB 스키마, 모듈 계약, 시연 시나리오

## 코드 작성 규칙

- 하나의 파일은 가능한 한 하나의 책임을 갖도록 작성합니다.
- 외부 API 호출 로직은 라우트 핸들러에 직접 몰아넣지 않고 서비스 계층으로 분리합니다.
- 백엔드는 `searchRoutes()`와 `getArrivalInfo()`의 역할을 분리해서 호출합니다.
- OpenAI 호출 실패 시 전체 경로 검색을 실패시키지 않고 기본 점수 규칙과 기본 안내 문장을 사용합니다.
- 확인되지 않은 동작을 완료된 기능처럼 주석이나 문서에 작성하지 않습니다.

## 변수명 규칙

- 공개 API와 JavaScript 변수는 `camelCase`를 사용합니다.
- DB 컬럼은 `snake_case`를 사용합니다.
- `destination`은 사용자가 입력한 목적지 이름입니다.
- `destinationStation.stationName`은 실제 하차 정류장 이름입니다.
- `candidateId`는 효린 `searchRoutes()` 후보 식별자, `routeNo`는 사용자에게 표시할 노선 번호입니다.
- `localBusId`는 ODsay `busLocalBlID`, `gbisStationId`는 ODsay `startLocalStationID`를 사용합니다.
- 위치 업데이트 중복 식별자는 `requestId`, 하차벨 요청 식별자는 `bellRequestId`입니다.
- 구버전 하차벨 boolean 필드는 사용하지 않습니다.

## API 응답 규칙

MVP 성공 응답은 공통 필드와 기능별 필드를 같은 객체에 둡니다.

```json
{
  "success": true,
  "message": "처리가 완료되었습니다.",
  "timestamp": "2026-07-01T14:30:00+09:00"
}
```

오류 응답은 다음 구조를 사용합니다.

```json
{
  "success": false,
  "message": "오류 내용",
  "errorCode": "ERROR_CODE",
  "timestamp": "2026-07-01T14:30:00+09:00"
}
```

## 외부 API 역할

```text
카카오 로컬 API
-> 사용자 입력 목적지 텍스트를 좌표로 변환

ODsay searchPubTransPathT
-> 출발지부터 목적지까지의 대중교통 경로 후보 조회

GBIS getBusArrivalListv2
-> 선택 후보의 gbisStationId와 localBusId로 실시간 버스 도착 예정 정보 조회

OpenAI API
-> 검증된 경로 후보 중 최종 후보 2개 선택, 추천 이유와 음성 안내 문장 생성
```

## 경로 검색 규칙

- `POST /api/routes/search` 요청값은 `destination`, `latitude`, `longitude`를 사용합니다.
- 백엔드는 카카오 로컬 API로 목적지 좌표를 변환한 뒤 효린 `searchRoutes(destination, latitude, longitude)`를 호출합니다.
- 중간평가에서는 환승 없는 직행 버스 후보만 사용합니다.
- 백엔드는 후보의 `stationList`를 검증한 뒤 OpenAI 모듈에 전달합니다.
- OpenAI가 선택한 `candidateId`는 실제 후보 배열에 존재하는지 반드시 검증합니다.
- 실패 시 백엔드 기본 점수 규칙으로 상위 2개를 선택합니다.
- 공개 API와 DB에는 ODsay 내부 경로 유형 값을 넣지 않습니다.

## 운행 생성 규칙

- 사용자가 최종 후보를 선택하면 `POST /api/trips`를 호출합니다.
- 백엔드는 선택된 `candidateId`가 직전 후보에 있는지 확인합니다.
- `stationList`를 검증합니다.
- 내부에서 `getArrivalInfo(selectedCandidate)`를 호출합니다.
- GBIS 조회 실패 시 `gbisStationId`, `predictedArrivalMinutes`는 `null`로 두고 운행 생성은 계속합니다.
- 초기 상태는 `tripStatus = WAITING_BUS`, `bellStatus = NOT_REQUESTED`입니다.

## 위치 업데이트 규칙

- 위치 전송은 `PATCH /api/trips/{tripId}/status`를 사용합니다.
- 상태 조회는 `GET /api/trips/{tripId}/status`를 사용합니다.
- `PATCH /status`는 위치 업데이트와 하차벨 요청 자동 생성을 담당하고, `GET /status`는 조회만 담당합니다.
- 중간평가에서는 앱이 3초마다 선택된 실제 노선의 정류장 좌표를 mock 위치로 전송합니다.
- 동일 `tripId + requestId` 재요청은 멱등 처리합니다.

## 하차벨 규칙

```text
remainingStations = 2
-> 사전 안내만 제공
-> shouldTriggerBell = false

remainingStations = 1
AND bellStatus = NOT_REQUESTED
-> 백엔드가 bellRequestId와 STOP_REQUEST 생성
-> bellStatus = PENDING
-> shouldTriggerBell = true

bellStatus = PENDING 또는 SUCCESS
-> shouldTriggerBell = false
```

- 앱은 별도 시작 요청 없이 상태 응답의 `bellRequestId`, `STOP_REQUEST`를 받아 BLE 또는 mock 하차벨에 전달합니다.
- 결과는 `POST /api/trips/{tripId}/bell/result`로 저장합니다.
- `tripStatus`와 `bellStatus`는 분리합니다.

## 환경변수 관리 규칙

- 실제 값은 `.env`에만 작성합니다.
- `.env.example`에는 변수 이름만 작성합니다.
- `.env`는 GitHub에 올리지 않습니다.
- 필수 API 키 이름은 다음을 사용합니다.

```env
KAKAO_REST_API_KEY=
ODSAY_API_KEY=
GBIS_SERVICE_KEY=
OPENAI_API_KEY=
```

## 개인정보 및 API 키 보안 규칙

- API 키는 코드, 문서, 커밋 메시지, PR 설명에 직접 작성하지 않습니다.
- 사용자 위치 정보는 필요한 범위에서만 사용합니다.
- 민감한 위치 정보와 토큰을 로그에 남기지 않습니다.
- Notion이나 로컬 메모에 실제 키가 있더라도 GitHub 문서에 옮기지 않습니다.

## 테스트 규칙

- 실행한 테스트만 성공했다고 보고합니다.
- 실행하지 못한 테스트는 이유를 남깁니다.
- API 변경 시 요청/응답 형식 테스트를 우선 확인합니다.
- 하차 안내 로직은 `remainingStations` 2, 1, 0 케이스를 테스트합니다.
- mock 데이터와 실제 API 데이터가 구분되는지 확인합니다.

## 문서 업데이트 규칙

- API가 바뀌면 `docs/API_SPEC.md`를 수정합니다.
- DB 필드가 바뀌면 `docs/DB_SCHEMA.md`를 수정합니다.
- 구조가 바뀌면 `docs/ARCHITECTURE.md`를 수정합니다.
- 중간평가 범위가 바뀌면 `docs/MIDTERM_SCOPE.md`를 수정합니다.
- 모듈 간 계약이 바뀌면 `docs/MODULE_CONTRACTS.md`를 수정합니다.
- 오류가 발생하고 해결했다면 `docs/TROUBLESHOOTING.md`에 기록합니다.

## 임시 코드와 주석 관리 규칙

- 임시 코드는 커밋 전 제거하거나 이유를 주석으로 남깁니다.
- 사용하지 않는 콘솔 로그는 PR 전에 정리합니다.
- 동작 설명보다 왜 필요한지 설명하는 주석을 우선합니다.
