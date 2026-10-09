# 리허설 및 후속 작업 실행 기록

계획: [2026-09-22-rehearsal-backlog.md](2026-09-22-rehearsal-backlog.md)

기준: `57e50ea`, 브랜치 `codex-rehearsal-backlog-20260922`. 원본의 `ebb5bdd`와 사용자 수정은 보존한다. 아래 로컬 검증 시점에는 커밋·푸시·운영 변경을 하지 않았다. 이후 사용자가 커밋과 PR 생성을 별도로 요청했다.

## 시작 시 판단

- 사용자 요청에 따라 계획 후 확인 대기 없이 실행한다.
- `.agent-loop/DIRECTOR.md`의 구현·시험·검토 분리를 적용하되 오래된 자동 커밋/푸시 권한은 현재 AGENTS 규칙에 따라 적용하지 않는다.
- `codex` 브랜치를 보존하기 위해 `codex/` 대신 `codex-` 접두어를 썼다.
- 오프라인 설치는 Supabase 패키지 캐시 부족으로 실패했다. 잠금 파일을 유지한 온라인 설치로 전환했다.
- fetch는 최신 커밋과 PR52/53/44 참조를 확보했다. 종료 중 옛 `bus-ta-pr33-review` 메타데이터 삭제 권한 오류가 났지만 해당 worktree는 수정·삭제하지 않는다.

## 사전 정합성 확인

| 경계 | 확인 |
|---|---|
| T1→T2 BLE | UUID/START/STOP/SET_TARGET/Notify 유지, 모터 출력만 변경 |
| T2→T3 상태/벨 | 기존 tripStatus/bellStatus와 API 보존, 중복 벨 생성 없음 |
| T2↔T4 Dispatcher | T2 완료 후 T4 이식, 무인자/후보/환승 가드를 함께 회귀 검증 |
| T3→T6 계약 문서 | atomic RPC를 기술하되 운영 적용 상태와 구분 |
| T4→T5 shared | 새 환승 타입과 상수 export 충돌 검증 |
| T1/T2/T3/T4/T5 | 각 단계에 재현 또는 기존 동작 회귀 시험 지정, 서로 다른 완료 기준 |
| T6/T7 | 과거 성공과 이번 시험을 분리하고 모든 조사 ID를 상태 표에 연결 |

## 단계별 결과

T1–T7의 로컬 구현·독립 시험·검토와 문서 정리를 완료했다. 실제 기기·외부 서비스·운영 적용은 별도 현장 확인 상태로 유지한다.

실행 배정 갱신: 최신 병렬 작업 지침에 따라 T1 검토와 T2(모바일)/T3(서버·DB)를 독립 진행한다. 각 작업의 구현→시험→검토 순서는 보존하고 수정 파일 소유권은 겹치지 않는다. T4/T5의 공용 파일 작업은 선행 작업 종료 후 실행한다.

### T1 설계 보완

펌웨어는 상태 변화 때만 평균 RSSI를 Notify했지만 앱 자동 탑승 판정은 원시 RSSI의 7초 연속 입력과 최대 4초 표본 간격을 요구한다. 안정적으로 가까운 경우 상태가 바뀌지 않아 입력이 끊기는 계약 불일치를 확인했다. T1에서 새 표본의 제한된 주기 Notify를 추가한다. 임계값을 낮추는 변경은 하지 않으며, 신호 누락 동안 마지막 표본을 재전송하지 않는다. 실제 자동 탑승 성공 판정은 여전히 현장 시험이 필요하다.

- 중간 검증: `node scripts/test-cane-feedback.mjs` 종료0, 8개 재생 시나리오 통과. `.agent-loop/T1-current-host-test.log`. 아직 펌웨어 통합 완료 판정은 아니다.
- PWM 변화량의 정수 반올림 때문에 호출 주기에 따라 감쇠 시간이 달라지는 초안 문제를 발견해 누적 잔여량 방식과 1/5/20/100ms 비교 시험으로 보완했다.
- 펌웨어의 BLE callback과 loop가 공유 상태를 동시에 다루는 경합을 검토 중이다. 제어기/이력/Notify 판정은 loop가 소유하고 늦은 스캔 결과는 세대로 걸러내는 방향으로 통합 범위를 좁혀 인계했다.
- 실행 절차 판단: 기존 Director 문서의 Luna Max 기본 배정으로 제어기 구현을 시작했으나 펌웨어 동시성 통합에 추가 검토가 필요했다. `subagent-driven-development`의 난도에 따른 에스컬레이션 절차를 적용해 해당 좁은 통합 작업은 더 강한 모델로 넘겼다. 이전 구현자는 중단해 동시 수정을 막았다. 구현·독립 시험·검토 분리는 유지한다.

### T2 설계 보완

최신 앱 전체를 검색한 결과 `createBoardingDetector`와 `subscribeCaneState`는 정의만 있고 호출자가 없다. 기존 조사에서 자동 탑승을 현장 미검증으로만 분류했던 것보다 구체적인 앱 연결 누락을 확인했다. 기존 감지 기준을 유지한 상태에서 Provider/운행 수명주기에 연결하고 실제 소비 경로 시험을 추가한다. 사용자 리허설의 수동 확정 성공은 이 누락을 검증한 것이 아니다.

T1/T2 경계 확인에서 기존 앱은 cane Notify JSON 길이에 필요한 MTU를 명시적으로 협상하지 않았다. 설치된 BLE-PLX의 `requestMTU`와 반환 `Device.mtu`를 확인하여 연결 협상·실패 처리를 T2에 추가한다. 실제 휴대폰/ESP32 협상은 현장 시험이다.

### T1 검토 후 보완

- 첫 독립 검증 13개 및 ESP32 컴파일은 통과했으나, Reviewer가 consume 이후 STOP/타깃 명령과 이전 Notify/PWM의 경합을 찾아 재작업했다.
- 일반 task mutex로 명령 수락과 출력 전체를 직렬화한 수정본은 15개 독립 호스트 시험과 ESP32 컴파일을 통과했다. BLE Notify는 인터럽트 차단 critical section 안에서 실행하지 않는다.
- 추가 SDK 검토에서 같은 characteristic 값의 Write/Notify 덮어쓰기를 확인했다. 송신 버퍼를 수신 characteristic 값과 분리하는 두 번째 재작업을 완료했다.
- 최종 독립 호스트 시험 **19 PASS**, ESP32 Arduino 3.3.12 / IDF 5.5.5 컴파일 **PASS**. Flash 1,107,858 bytes, RAM 41,868 bytes. Tester와 Director가 canonical/staged 소스 해시 일치를 확인했다. Reviewer 명세·품질 모두 APPROVE(`.agent-loop/T1-review.md`).
- 연결별 구독·MTU·connId 재사용을 관리하고 로컬 MTU185를 설정했다. 앱은 185를 요청하고 64 이상을 요구한다. 실제 prepared Write·MTU 협상·모터 duty·무선/RTOS 지연은 실물 미검증으로 남는다.

### 문서 대조에서 확인한 정정

`GET /status`는 오류 때 캐시의 `null`을 `[]`로 바꾸지만 기존 배열은 유지한다. 따라서 최초 계획의 “stale 공개 안 함” 표현은 잘못된 요약이었다. 현재 정책은 `UPSTREAM_ERROR`에서 이전 숫자를 최신 정보로 안내하지 않는 것이다. API 동작을 바꾸지 않고 계획·도착정보 문서·결정표를 정정했다. 값의 나이 공개와 이전 정보 별도 발화는 합의 전 확장하지 않는다.

### T3 구현 및 독립 검증

- `record_bell_result` 단일 RPC로 두 기록을 함께 저장한다. 최초 결과를 반환하고 legacy 부분 기록을 복구하며 CANCELLED/TRIP_DONE 상태는 변경하지 않는다.
- 새 migration: `20260922091013_atomic_bell_result.sql`. CLI 생성 후 이번 작업용 PostgreSQL 15.19에만 적용했다. 운영에는 미적용이다.
- 독립 Tester: 서비스/저장소 33/33, 실제 SQL rollback·멱등·권한·legacy 복구, 별도 연결 4종 Lock 경합, 기존 boarding SQL, T3 scoped typecheck, 보안 7/7 및 audit 모두 통과. 시험 fixture·장애 trigger·경합 연결 잔존 0 확인.
- 근거: `.agent-loop/T3-implementation.md`, `.agent-loop/T3-testing.md`, `.agent-loop/T3-review.md`. 독립 Reviewer spec/quality APPROVE, Director가 실제 SQL·repository/service 경계를 확인했다. T2 수정 중에 실행한 전체 서버 snapshot 393/400은 통합 완료 증거가 아니며 최종 T7에서 다시 실행한다.
- 계약 영향: legacy 다중 bell_logs에서 현재 요청이 아닌 과거 요청은 409로 거절해 현재 bellStatus의 잘못된 복구를 막는다. 현재 요청의 최초 결과 우선 규칙은 유지하며, 이 차이는 API/DB 문서와 모바일의 terminal 오류 처리에 맞춰 검토했다.
- 운영 반영 시 새 RPC migration 및 권한 확인이 서버 교체보다 먼저다. 이번 로컬 검증은 원격 Supabase/PostgREST 배포 검증을 대신하지 않는다.

### T2 보완 및 재검토

- Riding→Alight 이후에도 Provider 위치 추적이 이어지고, `TRIP_DONE`에서 완료 문구 한 번과 실제 출력 종료 또는 제한 시간·로컬 음성 대체 뒤 상태를 정리한다. 자동 탑승은 새 타깃 RSSI 표본→기존 판정기→서버 `AUTO_DETECTED` 확인에 연결했고 서버 성공 전 상태를 바꾸지 않는다.
- 첫 Reviewer가 완료 이후 늦은 BLE 연결이 새 `STOP_REQUEST`를 보낼 수 있는 P2 경합을 찾아 재작업했다. Alight·세션·sender가 전송 시작 전 현재 운행과 종료 상태를 다시 확인한다. 이미 시작한 write의 실제 Notify와 결과 저장은 보존한다.
- 보완 독립 재시험 **48/48 PASS**, 모바일 타입 검사 PASS. Reviewer 재검토는 명세·품질 모두 APPROVE. 상세 근거는 `.agent-loop/T2-implementation.md`, `T2-testing.md`, `T2-review.md`에 있다. T4 변경 이후 전체 회귀는 T7에서 별도 실행한다.
- 실제 휴대폰 GPS·BLE·WebRTC 출력, -60dBm/7초 자동 탑승, 탑승 뒤 종점 완료 음성은 미검증이다. 로컬 수명주기 시험을 실물 완주로 표현하지 않는다.

### T4 사전 대조

`git show ebb5bdd:docs/superpowers/specs/2026-09-03-multimodal-route-design.md`로 원 설계를 확인했다. 계획의 기본값 이름 `BUS_ONLY`는 잘못 옮긴 이름이어서 원 설계의 `DIRECT_BUS`로 정정했다. 환승 범위는 `ROUTE_SEARCH_SCOPE`, 사용자의 mock provider 설정은 `ROUTE_SEARCH_MODE`로 서로 다른 목적이다. 두 설정을 합치지 않는다.

### T4 구현 및 독립 검증

- 기존 직행은 기본값으로 유지하고, 명시적 `MULTIMODAL`에서 버스 환승·버스+지하철 후보를 검색·전체 구간 안내한다. 혼합 후보는 화면·음성 Dispatcher·서버에서 운행 생성을 차단한다. 최상위 호환 정류장 필드는 첫 버스 구간이며 전체 경로는 `segments`다.
- 캐시·방향·MOCK 모드와 기존 T2 음성 경로를 회귀 검증했다. 독립 관련 시험 **181/181 PASS**, shared/server/mobile 타입 검사와 변경 공백 검사 PASS. 근거는 `.agent-loop/T4-implementation.md`, `T4-testing.md`, `T4-review.md`; Reviewer 명세·품질 모두 APPROVE.
- 오래된 Notion의 직행 전용 문구와 공개 환승 안내 필드 충돌은 위 사용자 최신 확정 규칙으로 판단했다. 서버는 후보 검색 이력을 저장하지 않으므로 환승 메타데이터를 모두 지운 임의 직행 모양 요청의 출처까지 증명하지 않는다. 실제 GBIS/ODsay 표본·앱 화면·음성은 별도 확인이다.

### 기준선 및 검증 환경

- `pnpm install --frozen-lockfile --ignore-scripts`: 성공, 780개 패키지. 잠금 파일 변경 없음.
- `pnpm -r typecheck`: shared/server/mobile 모두 성공.
- `pnpm --filter @bus-ta/server test`: 375개 통과, 실패 0. 로그 `.agent-loop/baseline-server.log`.
- 별도 `scripts/*.test.mjs` 및 `scripts/*.test.ts`는 59개 중 56개 통과, 3개 실패. `realtime-response-queue.test.mjs` 218/257/293행의 장치 준비 의존성 및 즉시 START 정책이 최신 구현과 맞지 않는다. T2에서 최신 계약을 실제 검증하도록 갱신한다. 로그 `.agent-loop/baseline-scripts.log`.
- 기본 격리 실행은 Windows 하위 프로세스 `spawn EPERM`으로 실패했다. 동일 명령의 승인된 일반 권한 실행에서 위 결과를 확인했다. 제품 테스트 실패로 분류하지 않는다.
- [Zig 공식 배포 목록](https://ziglang.org/download/index.json)의 0.16.0 Windows 컴파일러를 격리 설치하고 SHA256 `68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e`를 대조했다.
- [Arduino CLI 공식 릴리스](https://github.com/arduino/arduino-cli/releases/tag/v1.5.1) 1.5.1 Windows ZIP은 공식 체크섬 `fabe42e0eb04d00e776a66178299ff95a46c623dbc260f997e58fd514853dd40`와 일치했다. ESP32 공식 코어 3.3.12 설치 완료. 개인 Arduino 디렉터리는 사용하지 않는다. 첫 빌드는 한글 경로를 처리하지 못한 링커 오류로 실패하여 작업 전용 영문 경로에서 재검증한다.
- Docker 엔진은 `sailor-ingest.sock` 접근 오류로 시작하지 못했다. 공장 초기화·기존 데이터 삭제를 하지 않고 [PostgreSQL 공식 안내](https://www.postgresql.org/download/windows/)의 EDB ZIP 기반 독립 실행으로 전환한다.
- PostgreSQL 15.19가 한글 경로에서 initdb UTF8 오류를 내어 도구/데이터를 이번 작업 전용 임시 영문 경로로 옮겨 초기화했다. `127.0.0.1:55439`의 독립 DB에 기존 migration 11개와 `boarding_confirmation_race.sql`을 실행해 성공했다. 운영 DB는 접속하지 않았다. 시험 fixture는 ROLLBACK했다.
- 도구 설치 파일은 `.agent-loop/tools/`에 한정하고 `.gitignore`에 제외했다.
- Supabase 기능 문서와 changelog를 조회했다. Markdown changelog 주소는 접근 오류였고 [HTML changelog](https://supabase.com/changelog)로 대체했다. RPC는 기존 프로젝트의 service_role 전용 권한 경계를 유지한다.
- 설치된 Supabase CLI 2.108.0은 `node node_modules/supabase/dist/supabase.js`로 버전과 `migration new --help`를 확인했다. 기본 격리에서는 개인 telemetry 파일 접근이 거절되어 같은 읽기 명령을 승인된 권한으로 실행했다. 운영 DB에 연결하지 않았다.
- 운영 확인 범위: 원본 루트·서버·모바일의 `.env`가 없고 현재 프로세스에 OpenAI/Realtime/GBIS/ODsay/Kakao 키 설정도 없다(이름·존재 여부만 확인). 보호 Realtime 200 smoke를 실행할 수 없다. 기존 기록의 배포 주소 `https://bus-ta.onrender.com/api/health` 읽기를 시도했지만 웹 도구 접근 불가, 직접 GET은 30초 시간 초과였다. 이 결과로 서버나 DB가 고장 났다고 단정하지 않는다. 운영 API/외부 표본 확인은 미완료다.

### 2026-09-23 이어서 확인

- 같은 Notion 연결에서 `self`를 다시 조회하니 연결된 공간은 `양예모님의 워크스페이스`이고 일반 검색은 사용 가능, AI 검색은 요금제상 사용할 수 없었다. 기준 문서 제목 3개와 `한이음 프로젝트`를 일반 검색했지만 해당 7개 문서의 정확한 결과를 찾지 못했다. 과거 프로젝트 개요 URL 1개도 다시 `object_not_found` 404였다. 현재 연결 범위에서 최신 7개 원문을 읽을 수 없으며, 삭제인지 다른 공간·권한 문제인지 단정하지 않는다. 로컬 계약·현재 사용자 확정 규칙으로 진행했다.
- 이번 작업 전용 `127.0.0.1:55439` PostgreSQL은 오늘 상태 조회에서 중지돼 있었다. T3의 전날 실제 SQL·동시성 검증 증거는 보존하며, 최종 T7의 SQL 재실행에 필요하면 같은 전용 데이터 경로만 다시 기동한다.
- 사용자가 제공한 [Notion 링크](https://app.notion.com/p/AWS-1-IAM-EC2-VPC-3adff779d69181909251e14cdc96dd7e?source=copy_link)는 주소상 `AWS 1 IAM EC2 VPC` 페이지이며, 현재 연결의 직접 fetch는 `object_not_found` 404(해당 페이지 ID `3adff779-d691-8190-9251-e14cdc96dd7e`)였다. 공개 웹 조회도 접근할 수 없었다. 이 링크를 한이음 7개 기준 문서의 원문으로 간주하지 않고 정확한 프로젝트 링크/연결 공간을 추가 확인한다.
- 사용자가 이어서 제공한 [한이음 프로젝트 링크](https://app.notion.com/p/367ff779d6918054a969ca8483c56d28?source=copy_link)는 Notion 연결 API에서는 역시 404였지만, 사용자 로그인 Chrome에서는 실제 프로젝트와 `프로젝트 관리` 하위 7개 문서를 열었다. [백엔드 개발 명세서](https://app.notion.com/p/3adff779d69181aab9c8e9bcd717ca8c), [공통 API 명세서](https://app.notion.com/p/API-Function-Calling-3a8ff779d6918198b92aef8ceb2012ed), [공통 데이터 모델](https://app.notion.com/p/3a9ff779d69181f9b1a5c44211429042) 본문을 브라우저에서 확인했다. 연결 권한 문제와 페이지 부재를 혼동하지 않는다.
- Notion의 직행 버스 전용 검색·기존 후보 필드 서술과 최근 T4 안내 전용 환승 설계는 충돌한다. 사용자는 **2026-09-23 현재 요청의 최종 규칙으로 “노션 명세는 안 건드린 지 오래되었으므로 최근에 제시한 방향과 최신 코드를 기준”**으로 확정했다. 따라서 최근 로컬 설계·코드를 이번 구현 판단에 우선하고, Notion과의 차이는 숨기지 않는다. Notion API 5.2-A의 최대 2대 `arrivals`·`occupancy`는 문서에서 구현 대기로 적혀 있으나 최신 shared schema/server adapter/service/API 문서에는 이미 구현되어 있어 과거 상태표를 현재 미구현으로 취급하지 않는다. 실제 좌석·혼잡도 실물 표본 확인은 V06에 남는다.
- Chrome 로그인 세션에서 프로젝트 관리의 기준 7개 문서 본문을 모두 열어 대조했다: [시스템 흐름](https://app.notion.com/p/3a8ff779d691814a95bcc27ef0286a1d), [공통 API](https://app.notion.com/p/API-Function-Calling-3a8ff779d6918198b92aef8ceb2012ed), [백엔드](https://app.notion.com/p/3adff779d69181aab9c8e9bcd717ca8c), [데이터 모델](https://app.notion.com/p/3a9ff779d69181f9b1a5c44211429042), [프론트엔드](https://app.notion.com/p/3a9ff779d691814d9effcbd422f31ca1), [Realtime](https://app.notion.com/p/GPT-Realtime-mini-OpenAI-3a8ff779d69181378a86c17c1d666157), [개발 규칙](https://app.notion.com/p/3a9ff779d691812cb7bee7e3d0fe5c9a). 앞선 연결 API의 404는 해당 계정 연결의 접근 범위 문제였으며, 로그인 브라우저의 열람 성공으로 문서 부재가 아님을 확인했다. 시스템 흐름은 모델이 버스 운행을 임의 판단하지 않고 서버 결과를 앱 Dispatcher로 전달하는 구조, TRIP_DONE과 CANCELLED의 구분을 명시한다. 현재 로컬 구현도 이 역할 경계를 따른다.
- 과거 7/26 인수인계의 Notion 정리 항목을 재판정했다. 개발 규칙 페이지는 현재 프로젝트의 `프로젝트 관리` 목록에서 직접 열려 위치 미정 문제를 해소했다. 공통 API 본문에서 과거 오타 `정류장첲럼`은 없고 `정류장처럼`으로 표시된다. 옛 `프로젝트 개발 규칙 및 기술 스택 정리` 페이지는 현재 프로젝트 최상위 목록에서 링크를 찾지 못했다. 이 페이지의 전체 STT/TTS 재정리는 과거 범위 밖 메모이고, 현재 사용자 확정 방향과 최신 코드에 맞춘 일괄 Notion 재작성은 이번 로컬 구현의 선행 조건으로 삼지 않는다. 옛 문구와 현재 계약의 차이는 이 결과표에 공개하고, Notion 자체는 변경하지 않았다.

### T6 문서·현장 인계

- 현재 계약 문서와 역사적 중간평가·인수인계 문서의 시점을 구분하고, 앱의 탑승 확정 전 GPS·하차 화면 위치 추적·벨 결과 RPC·환승 안내 전용 범위를 현재 구현과 맞췄다. `GET /status`가 오류 상태와 이전 도착정보 배열을 함께 보낼 수 있다는 실제 동작도 반영했다.
- [실물 재검증표](../../DEMO_SCENARIO.md#2026-09-22-이후-실물-재검증)에 13개 시나리오를 모두 미실행으로 두고, 앱·서버·펌웨어 식별자, 탑승 발화 전 거리 왕복, 자동/수동 탑승, 협상 MTU·CCCD·긴 BLE 쓰기, 2/1/0정류장, 실제 벨 결과와 종료 발화, 새 운행을 기록하게 했다. V02/V06–V09의 외부 표본·보호 Realtime 확인도 별도 조건으로 유지했다.
- [제한 문서 감사](../../../.agent-loop/T6-doc-audit.md) 당시 43개 ID가 중복·누락 없이 결과표에 있었고, 열람한 10개 문서의 로컬 링크 41개가 유효했다. 그 뒤 추가한 Notion 대조·사용자 우선 규칙·T5/T7 결과는 최종 통합 검증에서 다시 확인한다.

### T7 최종 검증 진행 기록

- Android 로컬 번들: `apps/mobile`에서 `EXPO_NO_TELEMETRY=1 node node_modules/expo/bin/cli export --platform android --output-dir ../../.agent-loop/tools/expo-android --max-workers 2`. 첫 기본 격리 실행은 Metro 하위 프로세스 `spawn EPERM`으로 exit1이었고, 같은 명령을 승인된 실행 환경에서 재시도해 exit0, Android 1,064개 모듈·HBC 3.04MB 생성. 하차벨 안내 P2 수정 뒤 구현자가 별도 `expo-android-t7-p2`에 다시 export해 exit0·1,064개 모듈·HBC 3,044,809 bytes를 확인했다. `react-native-webrtc`의 `event-target-shim` 미공개 하위 경로에 대한 Metro fallback 경고가 있었으나 번들은 완료됐다. 이는 APK 설치나 실기기 BLE/GPS/오디오 검증이 아니다.
- 최종 하차벨 화면·시험 수정 후 전체 `pnpm --filter @bus-ta/server test`: **471/471 PASS**, exit0 (`.agent-loop/T7-server-final.log`). `pnpm test:supabase-security`: **7/7 PASS**, `pnpm verify:supabase-security`: PASS, 각각 exit0 (`T7-security-test.log`, `T7-security-audit.log`). T5 독립 Tester가 lint·통합 typecheck·scripts **68/68**을 scripts P2 수정 후 재실행했고, T7 P2 뒤 다시 root typecheck(workspace+scripts)·lint와 집중 **21/21**, 추가 역방향/종료 harness **3/3**을 독립 확인했다. 변경 영향이 없는 build·C++ **19**·로컬 SQL rollback/ACL/실제 lock 경합 **4개**는 이전 동결 소스에서 검증했다(`T5-testing.md`, `T7-P2-testing.md`). 영향을 받지 않는 검사를 불필요하게 반복하지 않는다.
- 추가 읽기 전용 감사: 결과표 R/A/V/D/M **43행/고유 43개, 누락·추가 0**. 최종 수정·신규 Markdown 54개에서 상대 파일 링크 **66개, 누락 0**. Git 추가 diff 2,116행과 작업용 미추적 텍스트 28개에 대해 대표적인 API 키·DB URL 비밀값 패턴 발견 0. 이는 특정 패턴 검사이며 전체 보안 감사로 확대하지 않는다. `git diff --check` exit0. 원본 폴더는 `ebb5bdd`·기존 `claude/nice-archimedes-iv7iu0` 브랜치와 최초 관찰한 수정·미추적 목록 그대로였다. 검증 당시 feature 브랜치는 미커밋·미푸시였고 배포도 하지 않았다.

### T5 품질 게이트 보완

- 첫 T5 Reviewer는 명세 APPROVE, 품질 REJECT(P2)로 판정했다. ESLint가 TS 이름 검사를 TypeScript에 맡기지만 당시 `pnpm -r typecheck`의 workspace 범위에 root `scripts/*.test.ts` 3개가 없었다. 실제 잠재 분기의 미정의 이름이 검사 없이 통과하는 RED 재현을 남겼다.
- root `tsconfig.scripts.json`과 `typecheck:scripts`를 추가해 `pnpm typecheck` 및 CI에 연결했다. 확장 검사에서 찾은 시험 fixture의 필수 `routeCandidatesExpiresAt` 누락은 `null`로 바로잡았다. 독립 Tester는 세 파일 포함, 미정의 이름 TS2304·잘못된 타입 TS2322 거부, probe 제거 후 통합 typecheck·lint·scripts **68/68 PASS**를 확인했다. `exactOptionalPropertyTypes`는 기존 모바일 import 경계에 맞춰 이 scripts 설정에서만 끄고 strict·`noUncheckedIndexedAccess`는 유지한다. Reviewer 재판정은 **명세 APPROVE·품질 APPROVE**다(`.agent-loop/T5-review.md`).

### T7 하차벨 안내 경계 보완

- 최종 통합 Reviewer가 T3의 최초 결과 우선 계약과 Alight 화면의 소비 불일치를 발견했다. 예를 들어 최초 `SUCCESS`가 저장된 뒤 늦은 물리 `FAIL`을 제출하면 RPC와 최신 상태는 `SUCCESS`인데, 종전 화면과 Realtime 미연결 로컬 음성은 `FAIL`을 안내했다.
- 수정은 Alight 화면과 집중 통합 시험 두 파일이다. 물리 결과를 즉시 확정 표시하지 않고 `bell/result` 저장 뒤 조회한 서버 `bellStatus`의 `SUCCESS`·`FAIL`만 화면·로컬 음성·Realtime 알림에 반영한다. 미확정/조회 실패 및 완료·취소에서는 거짓 확정 안내를 하지 않는다. 구현자의 RED 새 시험 9건 실패→GREEN 집중 **21/21**, 독립 Tester의 집중 **21/21**·추가 역방향/종료 harness **3/3**, root typecheck·lint PASS. 최종 Reviewer는 이 P2 해소와 T1→T5 계약 경계를 다시 확인해 **명세 APPROVE·품질 APPROVE**로 판정했다(`.agent-loop/T7-review.md`).
- 검증에 쓴 폐기용 PostgreSQL 55440은 T5 구현 시험 직후 정상 종료했고, 최종 SQL 재검증용 55439도 `.agent-loop/pg-env.json`의 작업 전용 경로·포트와 실행 PID를 확인한 뒤 `pg_ctl stop -m fast`로 종료했다. 종료 후 `pg_ctl status`는 `no server running`이었다. 두 인스턴스의 작업용 데이터 파일은 삭제하지 않았다.

## 전체 조사 항목 처리표

`구현 중`은 완료 판정 전이다. `현장 확인`은 실물 관측이 필요한 작업, `계약 대기`는 현재 합의된 범위 밖의 확장이다. 선택 과제를 채택하지 않은 결정과 구현 미완료를 구분한다.

| ID | 항목 | 현재 처리 / 완료 조건 |
|---|---|---|
| R01 | 점진적 진동 | T1 로컬 완료. 19개 호스트 시험·ESP32 빌드·독립 검토 통과. 실제 모터 duty별 출력은 V05 |
| R02 | 재접근 복구 | T1 로컬 완료. 완전 신호 소실 후 약한 재접근 및 STOP/타깃 경합 포함. 실물 재접근은 별도 |
| R03 | 하차벨 이후 종료 | T2 로컬 완료. 위치 지속→TRIP_DONE→완료 음성 출력 종료→정리 시험·재검토 통과. 실물 확인은 V01 |
| A01 | 무인자 Function | T2 로컬 완료. 계약상 무인자 공백 허용, 유인자·잘못된 JSON 거절 시험 통과 |
| A02 | PR52 잔여 | T2 로컬 완료. 후보 진단/안내 보완, 이미 통합된 발음 보존 |
| A03 | PR53 잔여 | T2 로컬 완료. STOP 성공 뒤 해제, 실패 시 연결·재시도 경로 유지 |
| A04 | 지팡이 연결 재시도 | T2 로컬 완료. 최대 3회, 1초/2초, 취소·탑승 시 중단 시험 통과 |
| A05 | 실패 안내 | T2 로컬 완료. 실제 장치별 결과에 맞춤. 당시 문제 발화 원문이 없어 동일 발화 재현은 미확인 |
| A06 | 조회 간격 | T2 로컬 완료. nextArrivalRefreshInMs 기반 재예약과 60초 경계 시험 통과 |
| A07 | 벨 결과 원자성 | T3 로컬 완료: 단일 RPC, 독립 SQL·동시성 시험 및 검토 통과. 운영 적용은 별도 |
| A08 | 환승 검색 | T4 로컬 완료. 명시적 MULTIMODAL 검색·전체 구간 안내, 3중 운행 생성 차단 시험·독립 검토 통과. 실제 환승 추적은 미지원 |
| A09 | 동명 목적지 선택 | 검토 완료·계약 대기. 첫 Kakao 결과 선택 위험은 남음. 장소 후보 재확인 계약 필요 |
| A10 | PR44 캐시 시험 | T4 로컬 완료. 현재 정책 보존·반복 강제 요청/지속 오류/예외/stale 폐기 회귀 시험 통과 |
| V01 | 전체 실물 리허설 | 현장 확인. 사용자가 관측한 수동 탑승/물리 벨 성공은 보존, 최신 수정의 완주 증거와 구분 |
| V02 | 도착정보→실제 발화 | 현장 확인. 같은 운행 5→3→2분, 2분 진입 1회, 질문 최신값, 오류 안내 기록 |
| V03 | RSSI 기준 | 현장 확인. -60dBm/7초 유지. 실제 승차·옆 대기·통과 오탐/미탐을 수집 |
| V04 | 스캔 시작 정책 | 현 계약 유지: 타깃 설정 직후 즉시 START. 배터리/탐지시간 측정 뒤 정책 변경 검토 |
| V05 | 회로·PWM | T1 소프트웨어 + 현장 확인. DVM6C-J/2N2222 실제 회로 및 구동 최저 duty 확인 필요 |
| V06 | 좌석/혼잡도 표본 | 외부 표본 필요. 실제 0석, remainSeatCnt=-1과 crowded의 의미 확인 전 변환 규칙 유지 |
| V07 | 방향 예외 | T4 합성 100m·3회 목적지·순환 경계 시험 통과. 실제 GBIS 표본은 추가 확보 필요 |
| V08 | ODsay IP·쿼터 | 운영 확인 필요. 시연 직전 outbound IP와 등록값·쿼터 대조. CIDR 문의 발송/답변은 확인 안 됨 |
| V09 | Realtime smoke | 최신 배포의 200/model/expiresAt 기록 필요. 과거 발급·음성 시연 성공을 현재 실패로 해석하지 않음 |
| D01 | 다차량 비콘 | 계약 대기. 실제 차량 ID 공급·보드 배치·차량 선택 규칙 필요 |
| D02 | 탑승 전 남은 정류장 | 계약 대기. stopsAway의 원본/공개 필드/음성 규칙 필요. remainingStations로 대체 안 함 |
| D03 | 오류 때 stale 안내 | 현 정책 유지. 실패를 최신값으로 안내하지 않음. 표시/유효시간 합의 전 확장 안 함 |
| D04 | PATCH에 도착정보 | 현 정책 유지. GET의 도착정보와 앱 보존 규칙으로 처리 |
| D05 | system_logs | 선택 확장 미채택. 현재 필수 계약에 추가하지 않음 |
| D06 | fixture fallback | 개발 규칙에 명문화. DB 미설정 비콘 참조 조회만 허용, 쓰기/DB 오류 성공 위장 금지 |
| D07 | fixture ACTIVE | 시연용 사용 가능 목록과 운영 ACTIVE 조회의 차이를 명문화 |
| D08 | 인증·기록·관리자·ERROR | 계약 대기. 사용자 식별/소유권/상태 확정이 선행 |
| D09 | 마지막 후보 안내 | T2 로컬 완료. 내부 Function 결과의 남은 개수/소진 정보와 안내 시험 통과 |
| M01 | 옛 미완료 목록 | 최신 계획/결과를 진입점으로 연결. 역사적 완료·푸시 기록은 지우지 않음 |
| M02 | 문서 계약 정렬 | 첫 GPS/탑승확정·1551 fixture·stale GPS 설명 수정. T6에서 전체 대조 |
| M03 | seed 충돌 | 기존 운영값 보존 정책 유지. 값 교정 필요 시 대상 한정 새 migration |
| M04 | 선택 리팩터링 | 공통 helper/미사용 메서드 제거 미채택. 현재 수요 없이 구조 확대 안 함 |
| M05 | main·공통 상수 | T5 로컬 완료. 실제 build 경로와 단일 상수 출처 정리, 독립 시험·검토 APPROVE |
| M06 | 변경·worktree 보존 | 원본 변경 보존, 최신 기준의 전용 worktree에서 구현. 옛 폴더/브랜치 삭제 안 함 |
| M07 | 제출 자료 | 자료 확인 필요. 로컬 초안과 다른 최종 제출본 존재 여부, 실제 팀/멘토명·사진·영상 필요 |
| M08 | Notion 정리 | 기준 7개 본문·개발 규칙 페이지 위치·API 과거 오타를 브라우저에서 재확인. 연결 API 404는 접근 범위 차이. 옛 STT/TTS 페이지 전체 정리와 현행 계약으로의 일괄 갱신은 미실행이며, 9/23 사용자 규칙에 따라 오래된 Notion 문구를 이번 구현 계약으로 강제하지 않음 |
| M09 | 개인 도구 권한 | 과거 권고를 개인 설정 변경 승인으로 간주하지 않음. 현재 제품 수정 범위 밖으로 보존 |
| M10 | lint | T5 로컬 완료. 실제 ESLint·root scripts TS 검사와 CI 연결, P2 보완·독립 재검토 APPROVE |
| M11 | engines | T5 로컬 완료. pnpm11 Node 최소 요구·CI/Render와 정렬, 로컬은 Node24 시험 |
| M12 | 과거 낮은 우선순위 권고 | 운행 위치 판단은 haversine 적용 확인. 어댑터의 기존 거리 함수는 방향 경계 시험 대상으로 구분. 오류 코드 확장/옛 OpenAI 배선은 새 필수 과제로 채택 안 함 |

현장 실행표와 기록 기준은 [DEMO_SCENARIO.md](../../DEMO_SCENARIO.md#2026-09-22-이후-실물-재검증), 계약 판단은 [PENDING_DECISIONS.md](../../../personal-notes/PENDING_DECISIONS.md#2026-09-22-재평가)에 모았다. 실제 하차 감지와 목적지 정류장 GPS 도착을 같은 사건으로 기록하지 않는다.
