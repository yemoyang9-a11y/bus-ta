# GPT-Realtime 전환 노션 문서 정리 · 인수인계 (2026-07-26)

> 작성: Claude (클라우드 세션) · 브랜치: `claude/nice-archimedes-iv7iu0` · 최신 tip: origin과 동기화됨(`0263adb`, PR #2 `end_trip` 포함)
> 목적: STT/TTS 분리 구조 → GPT-Realtime mini + Function Calling 전환에 맞춰 노션 개발 문서 6종을 만들고 정합성을 맞춘 작업, Codex 코드-문서 대조 검수 결과, 그 과정에서 고친 백엔드 결함 하나를 이어받을 수 있도록 정리한다.
> 팀 공통 기준은 노션 「공통 API 및 Function Calling 명세서」와 「공통 데이터 모델 및 상태 명세서」가 우선한다. 로컬 `docs/API_SPEC.md`·`docs/DB_SCHEMA.md`는 7/1 중간평가 기준 구버전이라 판단 기준으로 쓰지 않기로 확정했다.
> 민감정보(키·토큰·URL) 없음 — 안전하게 공유 가능.

---

## 0. 오늘 세션에서 일어난 일 (요약)

1. 프로젝트 AI 적용 방향이 STT→GPT→TTS 분리 구조에서 **GPT-Realtime mini + Function Calling**으로 전환됨에 따라, 로컬 문서와 기존 노션 3종 문서(시스템 흐름·공통 API 명세서·GPT-Realtime 가이드) 사이의 충돌을 분석.
2. A급(세션 발급 API·Function Dispatcher 위치·PR#2 표기)·B급(다이어그램 자기모순·중복 문서·구버전 문서)·C급(누락된 상태 전이표·과장된 서술) 순으로 논의 후 3개 문서에 반영.
3. 세션 도중 사용자가 「공통 데이터 모델 및 상태 명세서」, 「개발 규칙 및 협업 컨벤션」 두 문서를 추가로 노션에 올려서, 각각 기존 문서·코드와 대조해 충돌을 찾고 반영. 「개발 규칙 및 협업 컨벤션」은 같은 제목의 페이지가 두 곳에 있었는데(원본이 더 충실) 위치를 정리했다.
4. 사용자 요청으로 「프론트엔드 개발 지침서」를 신규 작성(6번째 문서).
5. 6개 문서 전체를 markdown으로 export해 Codex CLI(로컬 코드 접근 가능)에 코드-문서 대조 검수를 맡김. 발견 9건 중 1건(처리되지 않은 Promise rejection으로 서버가 죽을 수 있는 문제)은 논의 후 바로 수정·테스트, 나머지 8건은 6개 문서에 "알려진 결함/정정"으로 반영.
6. `git pull`로 로컬 브랜치를 origin과 동기화(PR #2 `end_trip` 코드 획득), Supabase SQL Editor로 `cancel_trip` RPC 존재를 직접 확인해 마이그레이션 적용 여부를 검증함.

---

## 1. 완료된 작업

### 1-1. 코드 수정 (완료, 커밋 안 됨)

| 파일 | 변경 내용 |
|---|---|
| `apps/server/src/services/trip/update-trip-status.service.ts` | `findTripProgressData`·`findLocationLogByRequestId` 호출을 try/catch로 감싸 DB 장애 시 500 `DB_ERROR`를 반환하도록 수정. 기존엔 이 두 호출이 try/catch 밖에 있어서, Express 4에 전역 에러 핸들러가 없는 상태라 DB 순간 장애(3초마다 호출되는 `PATCH /status`에서) 시 처리되지 않은 Promise rejection → 최악의 경우 서버 프로세스 전체가 죽을 수 있는 문제였음. |
| `apps/server/src/services/trip/update-trip-status.service.test.ts` | 위 두 실패 경로에 대한 회귀 테스트 2건 추가. |

검증: `pnpm --filter @bus-ta/server exec tsx --test src/services/trip/update-trip-status.service.test.ts` → 12/12 통과(기존 10 + 신규 2). `pnpm --filter @bus-ta/server run typecheck` → 통과.
**커밋 안 됨** — 이어받는 사람이 커밋 여부 확인할 것. (참고: `npx tsx`는 이 pnpm 워크스페이스에서 직접 안 먹는다. `pnpm --filter @bus-ta/server exec tsx --test <path>`로 실행해야 함.)

### 1-2. 노션 문서 6종 정리 (완료)

모두 「한이음 프로젝트」 페이지 하위 "📌 프로젝트 관리" 그룹에 있음.

| 문서 | 상태 | 주요 변경 |
|---|---|---|
| 「한이음 시스템 전체 흐름 및 역할 분담 문서」 | 갱신 | 세션 발급/Dispatcher 위치 확정 반영, 다이어그램 자기모순(백엔드→AI 직접 전달로 보이는 3곳)에 정정 문구 추가, 우선순위에 신규 문서 반영 |
| 「공통 API 및 Function Calling 명세서」 | 갱신 | `POST /api/realtime/session` 계약 신설(6.1장, 미구현 상태 명시), 상태 전이는 데이터 모델 명세서로 단일화(4.4장은 요약+포인터), 오류 코드 3개 추가(`BELL_REQUEST_NOT_FOUND`·`INVALID_BELL_STATE`·`BEACON_NOT_FOUND`), Codex 발견 결함 2건 기록 |
| 「공통 데이터 모델 및 상태 명세서」 | **신규(사용자 작성) + 대폭 수정** | 사용자가 PR#2 병합 이전 기준으로 작성했던 걸 현재 코드 기준으로 갱신, 상태 전이의 단일 출처로 확정, 우선순위 목록에 편입, 하차벨 전이 다이어그램 오류 수정, Codex 발견 결함 4건 기록(1건은 수정완료 표시) |
| 「GPT-Realtime mini(OpenAI 파트) 개발 가이드」 | 갱신 | 참고 문서 목록·우선순위에 데이터 모델 명세서·프론트엔드 지침서 반영, PR#2 상태 갱신 |
| 「개발 규칙 및 협업 컨벤션」 | **위치 정리** | 중복 페이지 중 더 충실한 원본을 「한이음 프로젝트」 최상위로 이동(단, "📌 프로젝트 관리" 그룹 안으로의 정렬은 Notion API 제약으로 수동 드래그 필요). "(수정본)"에는 폐기 배너 + 원본 링크 추가 |
| 「프론트엔드 개발 지침서」 | **신규 작성** | Realtime 세션 연결, 세션 발급 API, Function/이벤트 Dispatcher, GPS·BLE 연동, 앱 상태 관리, 접근성 UI 외에 실행 환경 제약(Expo Go 불가·EAS 필요)·현재 화면 mock 상태·보안·오류 처리·화면 구성·개발 완료 기준까지 18개 장으로 구성 |

부수적으로 손댄 것: 7/25 초안 흐름 문서에 폐기 배너, 「프로젝트 개발 규칙 및 기술 스택 정리」의 STT/TTS 흔적 일부 정정(전체 재정리는 범위 밖으로 안 함), 「OpenAI 대화형 AI 파트 개발 지침서」는 사용자가 직접 휴지통으로 보냄.

검증: 모든 수정 문서를 `fetch`로 재조회해 반영 결과를 직접 확인함.

### 1-3. Codex 코드-문서 대조 검수 (완료)

6개 문서를 `C:\Users\yemoy\AppData\Local\Temp\claude\...\scratchpad\notion-docs\`에 export하고 Codex CLI에 검수 요청(로컬 코드 읽기 전용, read-only sandbox). 발견 9건:

- **높음(3건)**: 프론트엔드 지침서 3장이 실제보다 훨씬 구현된 것처럼 서술(화면 4개가 사실상 전부 mock) / `update-trip-status.service.ts`의 처리되지 않은 예외(→ 1-1에서 수정 완료) / `TRIP_DONE` 운행에 중복 `requestId`가 오면 409 아닌 200 반환
- **중간(4건)**: 하차벨 전이 다이어그램 들여쓰기 오류 / `health.ts` 500 응답에 `errorCode` 없음 / 오류 코드 표에 하차벨·비콘 관련 3개 누락 / `INVALID_STATION_LIST` 과잉 단정
- **낮음(1건) + 추가 공백(2건)**: `remainingStations`만으로 상태 결정된다는 서술 범위 과다 / 모바일 `client.ts`의 `beacons.list()`가 `routeNo` 인자를 못 받음 / 공유 시크릿을 앱에 안전하게 공급하는 방법 미정

1건(처리되지 않은 예외)만 사용자와 논의 후 바로 수정, 나머지 8건은 관련 문서(공통 API 명세서·데이터 모델 명세서·프론트엔드 지침서)에 "알려진 결함, 미수정" 또는 정정 내용으로 반영함.

---

## 2. 다음 작업 후보 (우선순위 미정 — 사용자 판단 필요)

1. **`end_trip` 실제 호출 통합 테스트** — 코드·DB 마이그레이션은 준비됐지만 실제 PATCH 요청→DB 상태 확인은 아직 안 함. 「공통 데이터 모델 및 상태 명세서」 11장 체크리스트의 마지막 항목.
2. **`POST /api/realtime/session` 백엔드 구현** — 계약(6.1장)만 확정, 코드 없음. 프론트엔드가 Realtime 연결 자체를 못 하는 블로커.
3. **미수정 결함 3건 처리 여부 결정**: `TRIP_DONE` 중복 요청 200 반환, `health.ts` errorCode 누락, 모바일 `beacons.list()` routeNo 누락.
4. **`apps/mobile` 화면 4개(ConfirmScreen·RouteListScreen·RidingScreen·AlightScreen) 실제 백엔드 연동** — 주석처리·비활성화 상태를 실제 호출로 전환. 이게 프론트 작업량의 큰 부분을 차지함(3-2 참고).
5. **저장소 브랜치 전략 문서 정리** — `CONTRIBUTING.md`가 존재하지 않는 `develop` 브랜치를 언급하고, `CLAUDE.md`는 `main` 기준으로 쓰여 있는데 실제 통합 브랜치는 `claude/nice-archimedes-iv7iu0`(main보다 71커밋 앞섬). 노션 「개발 규칙 및 협업 컨벤션」과 저장소 문서가 어긋난 상태.
6. 「공통 API 및 Function Calling 명세서」 5.2장에 오타 하나 남음("정류장첲럼"→"정류장처럼"). Notion API 유니코드 매칭 문제로 자동 수정 실패, 수동 수정 필요.

---

## 3. 알려진 이슈 / 주의사항

- 노션에 같은 제목의 문서가 종종 중복 생성됨 — 이번 세션에서만 「시스템 전체 흐름」·「개발 규칙 및 협업 컨벤션」 두 건 발견. 새 문서 작업 전 검색으로 기존 페이지 확인 권장.
- 세션 발급 엔드포인트(`POST /api/realtime/session`)를 구현할 때 공유 시크릿을 어떻게 앱에 안전하게 공급할지 아직 정해지지 않았다. `EXPO_PUBLIC_` 접두사에 넣으면 안 된다는 금지만 문서에 있고 대안은 없음.
- `apps/mobile`의 WebRTC·BLE 라이브러리는 아직 미선정이고, 둘 다 Expo Go에서 동작하지 않아 EAS development build 전환이 선행되어야 함. 전환 시점을 늦추면 Realtime·BLE 작업이 동시에 막힌다.
- 이 문서 자체는 스냅샷이며, 노션 문서와 코드는 계속 바뀔 수 있으니 착수 전 관련 문서·파일을 다시 확인할 것.
