# AI·BLE 기반 시각장애인 대중교통 탑승·하차 보조 시스템

이 저장소는 시각장애인이 버스를 이용할 때 겪는 버스 식별, 경로 선택, 이동 중 위치 확인, 하차 시점 판단의 어려움을 줄이기 위한 한이음 프로젝트입니다.

최종 개발 계약은 Notion 프로젝트 관리의 6개 핵심 문서와 아래 GitHub `docs/` 동기화 문서입니다. 코드의 현재 동작은 `claude/nice-archimedes-iv7iu0`와 실제 Supabase 적용 상태로 별도 확인합니다.

## 주요 기능

- 음성 기반 목적지 입력 및 STT 변환
- 카카오 로컬 API를 이용한 목적지 좌표 변환
- ODsay `searchPubTransPathT` 기반 대중교통 경로 후보 조회
- 중간평가 범위에서는 환승 없는 직행 버스 후보만 사용
- OpenAI API를 이용한 최종 후보 2개 선택, 추천 이유와 안내 문장 생성
- 사용자가 선택한 경로로 운행 생성
- GBIS 도착정보 조회를 `POST /api/trips` 내부에서 처리
- mock GPS 또는 실제 GPS 좌표 기반 현재·다음·남은 정류장 계산
- 하차 2정거장 전 사전 안내, 1정거장 전 하차벨 신호 생성
- BLE 또는 mock 하차벨로 `STOP_REQUEST` 전달
- ESP32 기반 스마트지팡이, 버스 비콘, 하차벨 모형은 최종 단계에서 실제 연동

## 전체 동작 흐름

```text
사용자 음성 입력
-> React Native 앱
-> Node.js 백엔드
-> 카카오 로컬 API
-> ODsay API
-> 후보 경로 검증
-> OpenAI API가 최종 후보 2개 선택
-> 경로와 버스 정보 반환
-> 사용자가 경로 선택
-> POST /api/trips 내부에서 GBIS 도착정보 조회
-> 운행 생성 및 DB 저장
-> mock GPS 또는 GPS 위치 업데이트
-> 버스 이동 상태 추적
-> 하차 정류장 접근 판단
-> TTS 안내
-> BLE 또는 mock 하차벨
-> ESP32 진동 또는 하차벨 신호
```

## 기술 스택

- 프론트엔드: React Native
- 백엔드: Node.js, Express
- 데이터베이스: Supabase PostgreSQL 기준
- 외부 API:
  - 카카오 로컬 API: 목적지 텍스트를 좌표로 변환
  - ODsay `searchPubTransPathT`: 출발지부터 목적지까지의 대중교통 경로 후보 조회
  - GBIS `getBusArrivalListv2`: 선택 후보의 `gbisStationId`와 `localBusId`로 실시간 도착정보 조회
  - OpenAI API: 최종 후보 2개 선택, 추천 이유와 음성 안내 문장 생성
- 하드웨어: ESP32, BLE, 스마트지팡이, 하차벨 모형
- 데이터 형식: JSON, API 필드는 `camelCase`
- 환경변수: `.env`, 예시는 `.env.example`

## 저장소 폴더 구조

현재 브랜치는 pnpm 워크스페이스 기반 모노레포 구조를 사용합니다.

```text
.
├── README.md
├── AGENTS.md
├── CLAUDE.md
├── CONTRIBUTING.md
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   ├── mobile/             # React Native/Expo 앱
│   └── server/             # Node.js/Express API 서버
├── packages/
│   └── shared/             # 공통 타입, 상수, Zod 스키마, 시연 fixture
├── hardware/               # ESP32/BLE 관련 하드웨어 문서 및 코드
├── supabase/               # Supabase 마이그레이션 및 DB 자료
├── docs/
│   ├── PROJECT_OVERVIEW.md
│   ├── MIDTERM_SCOPE.md
│   ├── ARCHITECTURE.md
│   ├── API_SPEC.md
│   ├── DB_SCHEMA.md
│   ├── DEVELOPMENT_RULES.md
│   ├── MODULE_CONTRACTS.md
│   ├── DEMO_SCENARIO.md
│   └── TROUBLESHOOTING.md
```

## 설치 및 실행 방법

브랜치의 실제 `package.json`과 각 앱 폴더의 실행 스크립트를 기준으로 실행합니다. 의존성 설치와 실행 명령은 구현 변경 시 함께 갱신해야 합니다.

기본 실행 흐름:

```bash
pnpm install
```

```bash
cd apps/server
pnpm dev
```

```bash
cd apps/mobile
pnpm start
```

## 환경변수 설정 방법

1. `.env.example`을 복사해 `.env` 파일을 만듭니다.
2. 실제 API 키와 비밀번호는 `.env`에만 작성합니다.
3. `.env` 파일은 GitHub에 올리지 않습니다.

```bash
cp .env.example .env
```

필수 외부 API 키:

- `KAKAO_REST_API_KEY`
- `ODSAY_API_KEY`
- `GBIS_SERVICE_KEY`
- `OPENAI_API_KEY`

## 최종 개발 문서

- [프로젝트 개요 및 전체 흐름](docs/PROJECT_OVERVIEW.md)
- [공통 API 및 Function Calling 명세](docs/API_SPEC.md)
- [공통 데이터 모델 및 상태 명세](docs/DB_SCHEMA.md)
- [모듈 계약과 책임 경계](docs/MODULE_CONTRACTS.md)
- [프론트엔드 개발 지침](docs/FRONTEND_GUIDE.md)
- [GPT-Realtime mini 개발 가이드](docs/REALTIME_GUIDE.md)
- [개발 규칙 및 협업 컨벤션](docs/DEVELOPMENT_RULES.md)

## 참고·이력 문서

- [7/1 중간평가 범위](docs/MIDTERM_SCOPE.md)
- [아키텍처](docs/ARCHITECTURE.md)
- [시연 시나리오](docs/DEMO_SCENARIO.md)
- [오류 해결 기록](docs/TROUBLESHOOTING.md)
- [기여 가이드](CONTRIBUTING.md)
- [Codex 작업 규칙](AGENTS.md)

## 현재 개발 상태

- GitHub 원격 연결: 완료
- GitHub Markdown 문서 초안 작성: 완료 후 Notion 최신 규칙 반영 중
- 원격 `claude/nice-archimedes-iv7iu0` 브랜치 초기 모노레포 스캐폴드: 확인됨
- 실제 외부 API, DB, BLE 연동 구현 상태: 코드 기준 추가 확인 필요
- 중간평가 목표: 앱 목적지 입력부터 노선 선택, mock 이동, 하차 판단, TTS 안내까지 하나의 소프트웨어 흐름 연결
- 하드웨어 실제 BLE/ESP32 연동: 7/1 중간평가 이후 범위
