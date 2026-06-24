# CLAUDE.md — bus-ta 모노레포 지침

## 프로젝트 개요

AI·BLE 기반 시각장애인 대중교통 탑승·하차 보조 시스템 (한이음 프로젝트).  
상세: @docs/project-context.md

## 기술 스택

| 영역 | 기술 |
|---|---|
| 모바일 | Expo + React Native + TypeScript |
| 백엔드 | Node.js + Express + TypeScript |
| DB | Supabase |
| 검증 | Zod |
| 패키지 | pnpm workspace |
| 외부 API | 카카오 로컬, 경기도 GBIS, OpenAI |
| 하드웨어 | ESP32 (버스 비콘, 스마트지팡이, 스마트 하차벨) |

## 모노레포 구조

상세: @docs/repository-structure.md

```
apps/mobile       Expo 앱
apps/server       Express 서버
packages/shared   공유 타입/상수/스키마/픽스처
hardware/         ESP32 펌웨어 자리
docs/             설계·API·시연 문서
supabase/         DB 마이그레이션
```

---

## 핵심 규칙 (위반 시 PR 반려)

### 1. API 경로 단일 출처

모든 API 경로는 `packages/shared/src/constants/api-paths.ts`에서만 정의·참조한다.  
앱·서버 어디서도 경로 문자열을 하드코딩하지 않는다.

상세: @docs/api/api-spec.md

### 2. 폐기 API 사용 금지

절대 생성하거나 호출하지 않는다:

- ~~`GET /api/trips/{tripId}/bell`~~ → `GET /api/trips/{tripId}/status` 사용
- ~~`POST /api/ble/result`~~ → `POST /api/trips/{tripId}/bell/result` 사용

### 3. 상태값 규칙

`tripStatus`: `WAITING_BUS` → `ON_BUS` → `NEAR_DESTINATION` → `TRIP_DONE` (오류: `ERROR`)  
`bellStatus`: `NOT_REQUESTED` → `PENDING` → `SUCCESS` | `FAIL`

전환 책임:
- `GET` 조회 → **상태 불변**
- `POST /bell/request` → `NOT_REQUESTED`/`FAIL` → `PENDING`
- `POST /bell/result` → `PENDING` → `SUCCESS`/`FAIL`

### 4. requestId vs bellRequestId 구분

| 식별자 | 용도 | 위치 |
|---|---|---|
| `requestId` | GPS/mock 위치 업데이트 중복 판정 전용 | `types/location.ts` |
| `bellRequestId` | `/bell/request` ↔ `/bell/result` 연결 전용 | `types/bell.ts` |

두 식별자는 브랜디드 타입으로 정의되어 상호 대입 불가. 절대 혼용하지 않는다.  
상세: `packages/shared/src/types/ids.ts`

### 5. Mock 책임 구분

| 역할 | 위치 |
|---|---|
| 시연 데이터 단일 출처 | `packages/shared/src/fixtures/` |
| mock 좌표 전송 순서 제어 | `apps/mobile/src/demo/` |
| 정류장 계산 (좌표 → 상태) | `apps/server/src/services/trip/` |
| mock 하차벨 결과 생성 | `apps/server/src/adapters/bell/mock-bell.adapter.ts` |

### 6. 브랜치 및 PR

- `main` 브랜치 직접 push **금지**
- 기능별 브랜치(`feat/`, `fix/`) 생성 후 Pull Request 사용
- PR 전 `.github/pull_request_template.md` 체크리스트 확인

### 7. 구현 전 문서 확인

새 기능 구현 전 반드시 관련 docs 파일을 먼저 읽는다:  
@docs/api/api-spec.md · @docs/architecture/data-flow.md · @docs/database/schema.md

### 8. 비밀키 금지

비밀키·실제 환경변수 값을 코드에 커밋하지 않는다. `.env.example`의 키 이름만 허용.
