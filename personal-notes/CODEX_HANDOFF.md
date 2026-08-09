# 백엔드 인수인계 — Codex/Claude Code — 2026-08-09 (**노선 검색 정상화됨** — ODsay 등록 IP 불일치 해결, PR #18 병합, 열린 PR 0건, Realtime smoke 1단계만 통과)

> 다음 로컬 에이전트가 현재 백엔드 상태를 사실대로 이어받기 위한 source of truth다.
> 실제 비밀값, API 키, 토큰, Supabase 키, Realtime `clientSecret`, 응답 원문은 포함하지 않는다.
> 이 문서 자체는 실행 승인서가 아니다. 운영 쓰기·삭제, 배포 설정 변경은 그때마다 사용자 승인을 다시 받는다.

> **이 파일의 위치 주의**: 이 최신본은 `.worktrees/yemo-develop` worktree에 **미커밋 상태**로 있다.
> 저장소에 커밋된 버전은 더 오래된 내용이다. 다른 checkout이나 클라우드 세션은 이 내용을 볼 수 없다.

---

## 0. 이번 세션(2026-08-09 07:20~08:32 UTC)에서 바뀐 것

### 0.1 노선 검색이 살아났다 — 최우선 미결이 해소됐다

**운영 `POST /api/routes/search`가 후보를 반환한다.** 프로브 6건 전부 성공했다(08:14 UTC, 응답 1~3초).

| 프로브 | 결과 |
| --- | --- |
| 수원대 → 수원역 | 후보 2건 (1007, 700-2) |
| 수원대 → 병점역 | 후보 2건 (1551, 1551B) |
| 수원역 → 아주대학교 | 후보 2건 (32-4, 80) |
| 아주대 → 수원역 | 후보 2건 (13-4, 720-2) |
| 강남역 → 양재역 | 후보 2건 (서초09, 405) |
| 병점역 → 수원역 | 후보 1건 (301) |

**원인은 (c) 등록 IP 불일치였고, 서버 코드에는 고칠 것이 없었다는 이전 판의 진단이 맞았다.** 어댑터·필터를 한 줄도 건드리지 않았다.

- 팀원 답장으로 (a) Web 키 가설이 배제됐다 — Render 에 쓰인 것은 **Server 키**다.
- ODsay 콘솔에 등록돼 있던 IP 는 **둘뿐**이었고, 조회해 보니 **국내 가정용 회선**이었다(하나는 인천 SK Broadband, 하나는 수원 Korea Telecom). 팀원 로컬이다. **실제 주소는 개인 회선이므로 공개 저장소인 이 문서에 적지 않는다 — 필요하면 ODsay 콘솔에서 직접 본다.** 배포 리전이 싱가포르이므로 **Render outbound IP 는 애초에 등록된 적이 없었다.** 이것으로 관측된 단서가 전부 설명된다(효린 로컬 캡처만 성공 / 운영은 지역·조합 무관 100% 실패 / Kakao 만 정상).
- (d) "저장된 값이 키와 다르다" 가설도 세웠으나 (c) 확정으로 볼 필요가 없어졌다.

**PR #14 가 이번에 처음 실물로 검증됐다.** 수원대→병점역의 `1551` / `1551B` 는 정류장 목록·소요시간·거리·요금이 완전히 같고 `routeNo` 만 다르다 — 같은 `subPath` 를 공유하는 `lane` 이 각각 후보가 되는 동작 그대로다. 그동안 ODsay 가 막혀 실제 확인이 불가능했던 항목이다.

### 0.2 코드 변경 1건 — PR #18 (병합됨)

`ApiKeyAuthFailed` 를 풀려면 Render 의 outbound IP 를 ODsay 에 등록해야 하는데, **등록할 주소를 알아낼 방법이 없다는 것이 진짜 병목이었다.** 그래서 서버가 부팅할 때 자기 공인 IP 를 1회 조회해 `[startup] outbound ip=...` 를 로그에 남기게 했다.

- 브랜치 `yemo/log-outbound-ip`, 커밋 `183e8de`, worktree `.worktrees/outbound-ip`.
- PR #18 병합 `b3e2245d`(08:06:36 UTC) → 자동 배포 → 사용자가 로그의 값을 ODsay 에 등록 → 프로브 성공.
- TDD. 시그니처 스텁 상태에서 신규 테스트 4개가 각각 기대한 assertion 으로 실패하는 것을 확인한 뒤 구현했다. 서버 테스트 **104 → 108/108 pass**, `pnpm -r typecheck` 3개 패키지 통과, 서버 build exit 0.
- **공개 API 를 추가하지 않았다**(명세에 없는 엔드포인트 신설 금지). 계약 문서 변경 0건, 기존 9개 API 동작 불변, 운영 DB 쓰기 없음.
- 조회 실패는 부팅을 막지 않는다. 응답을 기다리지도 않는다.
- 보안: 조회 서비스 응답은 외부 입력이므로 IPv4 형태가 아니면 원문을 로그에 남기지 않는다(응답에 개행을 심어 가짜 로그 줄을 만드는 것을 막는다). 테스트로 강제.
- 상세는 3절 Task 21.

### 0.3 막다른 길로 확인된 경로들 — 다음 세션은 반복하지 말 것

전부 이번 세션에 실제로 시도해 배제했다.

- **`bus-ta.onrender.com` DNS 조회로 나오는 `216.24.57.7` / `216.24.57.15` 는 인바운드 엣지 IP 다.** 등록해도 소용없다. ODsay 가 보는 것은 outbound 다. 같은 조회에서 origin 이 `gcp-us-west1-...` 로 보이는데 이것도 엣지 라우팅이라 실행 리전과 무관하다(실제 egress 는 `ip-74-220-52-1.singapore-egress.render.com`, 싱가포르가 맞다).
- **ODsay 는 등록 IP 를 최소 1개 강제한다.** 목록을 비워 "전체 허용"으로 만드는 경로는 저장 자체가 거부돼 막혔다.
- **Render 대시보드(`Connect` → `Outbound`)는 개별 주소를 주지 않는다.** `74.220.52.0/24`, `74.220.60.0/24` 두 대역(512개)만 알려주고, ODsay 입력창은 단일 IP 만 받아 슬래시 표기를 "공인 IP 가 아니다"로 거부한다.
- **`mcp__supabase__get_logs(service: api)` 로는 서버 접속 IP 를 알 수 없다.** `event_message` 는 method/status/user-agent 만 담고 **클라이언트 IP 필드 자체가 없다.**

### 0.4 남은 위험 — 시연 전 반드시 확인할 것

**Render 무료 플랜의 outbound IP 는 고정이 보장되지 않는다.** 대역이 두 개 공지된다는 것 자체가 그 안에서 바뀔 수 있다는 뜻이고, 무료 인스턴스는 15분 무활동으로 잠들었다 깨며 재스케줄된다. 지금 등록한 것은 512개 중 하나다.

**IP 가 바뀌면 노선 검색이 다시 통째로 죽는데, 증상이 502 가 아니라 "그냥 결과가 없다"라서 현장에서 알아채기 어렵다.** 이번에 겪은 것이 정확히 그 모양이었다.

- 확인 방법: cold start 마다 `[startup] outbound ip=` 가 새로 찍힌다. **시연 당일 아침에 이 값이 ODsay 등록값과 같은지 대조한다.**
- 안정성 관측: 서버를 15분 재운 뒤 깨우고 로그의 새 값을 비교한다. 며칠 같으면 사실상 고정으로 보고 써도 되고, 한 번이라도 바뀌면 아래 근본 해결이 필요하다.
- **근본 해결(미착수)**: ODsay 에 대역(CIDR) 등록이 가능한지 문의한다. 되면 IP 변동을 신경 쓸 필요가 없어진다. 안 되면 Render 유료 dedicated IP 또는 고정 IP 프록시이며 전부 비용이 드는 사용자 결정 사항이다.

### 0.5 다음 세션이 지금 바로 할 수 있는 것

ODsay 병목이 풀려서 이전 판에서 막혀 있던 항목들이 열렸다.

**승인 없이 가능**

1. **`GET /api/beacons` 통합 검증** — 운영 DB 쓰기가 없는 유일한 gate. (6절 5~9번)
2. **outbound IP 안정성 관측** — 서버를 재웠다 깨우고 로그 값 비교. 로그 열람은 사용자 몫이다.

**사용자 실행 권장**

3. **Realtime 세션 smoke 2단계** — 올바른 `REALTIME_SHARED_SECRET` 으로 `200`·모델 `gpt-realtime-mini`·`expiresAt` 미래 확인. 시크릿을 에이전트 대화에 노출하지 말고 결과 3가지만 공유하는 방식을 권장한다. 발급된 `clientSecret` 값은 출력·기록 금지. (6절 3번)

**사전 승인 필요 (운영 DB 쓰기)**

4. **실제 외부 API E2E** — 방금 받은 후보를 그대로 `POST /api/trips` 에 넣어 GBIS `predictedArrivalMinutes` 가 `null` 이 아닌지 확인한다. **운영 Supabase 에 운행 행을 만든다.** Task 13 처럼 exact-ID 격리·정리를 함께 계획하고 사전 승인 문구를 받는다. (6절 4번)

---

## 0-0. 이전 판(2026-08-08 12:00~15:30 UTC)에서 바뀐 것

**이번 세션의 코드 변경은 0건이다.** 병합 확인, 운영 진단, 문서 갱신만 했다. 커밋·push도 하지 않았다.

### 0.1 열린 PR 0건 — 대기하던 병합이 전부 끝났다

| PR | 결과 | 시각 |
| --- | --- | --- |
| #16 (문서, Windows curl 인코딩) | `MERGED` `db7e63a0` | 2026-08-07T15:39:50Z |
| #17 (PR #3 충돌 해소본) | `MERGED` `122e86de` | 2026-08-07T15:40:11Z |
| #3 (채린 프론트엔드) | `MERGED` **자동** | 2026-08-07T15:40:13Z |

**PR #3은 따로 닫을 필요가 없었다.** 이전 판이 "병합 후 PR #3을 닫는다"고 적었지만, PR #17이 `chaerin-develop` 팁(`276e38b`)을 포함한 채 병합되자 그 커밋들이 base에서 도달 가능해져 GitHub가 2초 뒤 자동으로 `MERGED` 처리했다.

- 통합 브랜치 head: **`122e86dec43ea426f798eeb9535bbb31dcbfe422`**
- `gh pr list --state open` → `[]`
- 운영 health: `200`, `serverStatus UP`, `dbStatus UP`

### 0.2 노선 검색 후보 0건 — 원인이 **ODsay 키 인증 실패**로 확정됐다

**서버 코드에는 고칠 것이 없다.** 어댑터 필터 가설은 배제됐다. 실측 근거는 `.agent-loop/CURRENT_TASK.md`(Task 19)에 전부 있다.

확정된 사실:

- 사용자가 Render Logs에서 확인한 값: **`code=500 message=[ApiKeyAuthFailed] ApiKey authentication failed.`** 호출 한도 문제가 아니라 키 인증 실패다.
- 프로브 **7건 전부** `200` + `routes: []`. 수원 권역 5건에 강남역→양재역까지 포함했는데 지역·거리·노선 밀도와 무관하게 전부 0건이다. **502가 하나도 없으므로 Kakao geocoding은 7건 모두 성공했다.** 재사용 스크립트는 `.agent-loop/probe-routes.sh`(본문을 UTF-8 파일로 넘겨 인코딩 함정을 회피한다).
- **어댑터 필터는 실제 캡처 데이터에서 정상 동작한다.** 어댑터 테스트 9/9 pass. fixture(`odsay-...-suwon-to-byeongjeom.json`) 직접 분석 결과 `path` 1건이 `pathType=2`/버스 1구간/정류장 14개/`lane` 4개로 필터를 그대로 통과한다 — 같은 pair를 운영에서 던지면 후보 4개가 나와야 하는데 0개다.
- `render.yaml`의 환경변수 **이름은 코드와 일치**한다(이름 불일치 배제). 단 전부 `sync: false`라 값 자체는 이 파일로 확인 불가. 배포 리전은 **`singapore`**.

남은 분기 — ODsay가 밝힌 `ApiKeyAuthFailed`의 원인 3가지 중 어느 것인가:

| | 원인 | 상태 |
| --- | --- | --- |
| (a) | **Web 키를 서버에서 사용.** ODsay는 서버 호출에 Server 키를 요구한다(Web 키는 도메인, Server 키는 IP로 식별) | **배제됨 (2026-08-09).** 담당 팀원 확인: Render에 쓰인 키는 **Server 키**다 |
| (b) | 키 값이 이미 URL 인코딩된 상태로 저장돼 axios가 이중 인코딩 | **배제됨.** 사용자가 Render 값에 `%` 없음을 확인 |
| (c) | **Server 키인데 Render 호출 IP가 등록 IP와 불일치** | **1순위 — 미확인.** ODsay 콘솔의 등록 IP 목록 확인 필요 |
| (d) | **Render에 저장된 값이 그 Server 키와 다르다**(잘림·공백 혼입·다른 앱 키). `%` 검사로는 걸러지지 않으며 증상이 (c)와 동일 | **미확인. (c)보다 먼저 갈라내야 한다** |

(b)는 axios `1.18.1`로 직접 실측해 판별했다 — 원본 키 `abC+dEf/gh=`는 `abC%2BdEf%2Fgh%3D`로 정확히 나가고, 이미 인코딩된 값은 `abC%252B...`로 깨진다. **값 자체를 볼 필요 없이 `%` 유무만으로 판별된다.** 상세는 CURRENT_TASK.md 6-1절.

효린이 로컬에서 실제 응답을 캡처했다는 사실이 **(c)를 시사한다** — 효린 IP로 등록된 Server 키라면 "로컬 성공·Render 실패"가 정확히 설명된다. **(c)로 확정되면 무료 플랜에서는 해결이 막힐 수 있다** — Render 무료 outbound는 리전 공유 CIDR이고 전용 고정 IP는 유료다.

**다음 측정(무료·운영 무영향): 키를 가진 팀원이 Render 환경변수에 든 값 그대로 로컬에서 ODsay를 1회 호출한다.** 정상 응답이면 값은 유효하므로 **(c) 확정**이고, 로컬에서도 `ApiKeyAuthFailed`면 **(d) 확정**이라 IP 등록을 뒤질 필요가 없다. **(c)로 확정되기 전에 Render 유료 전환·프록시를 검토하지 않는다.** 상세는 CURRENT_TASK.md 6-1절.

**에이전트는 Render 로그·환경변수·ODsay 콘솔에 접근할 수 없다**(로컬에 Render CLI도 API 키도 `.env`도 없다). 이 확인은 사용자·팀원 몫이다.

### 0.3 Realtime 세션 smoke — 1단계 재검증 완료

배포본 `122e86de` 대상으로 무인증 거부를 다시 확인했다. 헤더 없이 호출해도, 틀린 시크릿으로 호출해도 `401` + `errorCode: UNAUTHORIZED`다. 「공통 API 및 Function Calling 명세서」 6.1 계약과 일치하고 폐기된 `SERVER_CONFIG_ERROR`·`500`이 새지 않는다.

**이 결과가 증명하지 못하는 것**: `routes/realtime.ts:14`가 서버에 시크릿이 없을 때와 요청 값이 틀렸을 때를 **의도적으로 똑같이 401로 처리한다**(설정 상태를 응답으로 노출하지 않으려는 설계). 따라서 401 두 건은 Render에 `REALTIME_SHARED_SECRET`이 설정돼 있다는 증거가 **아니다.** 2단계(보호 요청 `200`)는 미실행이며 상세는 6절 3번.

### 0.4 그 밖에 확인된 사실

- **`POST /api/routes/search`는 DB를 건드리지 않는다**(코드 확인). Kakao·ODsay만 호출하고 GBIS도 부르지 않는다(`getArrivalInfo`는 `POST /api/trips` 전용). 이 엔드포인트 프로브는 운영 쓰기 없는 안전한 조회다.
- **서버 테스트 104/104 pass를 직접 실행해 확인했다**(`.worktrees/route-search-observability`). 그 worktree의 `apps/server`·`packages/shared`가 배포본 `122e86d`와 **완전히 동일함**(`git diff` 0건)을 대조했으므로 배포 코드에 대한 유효한 측정이다.
- **Free 인스턴스 cold start가 이번에 약 45초였다**(13:50:43 요청 → 13:51:28 응답). 프로브가 느려도 장애가 아니다.
- **`STTScreen.js`는 Realtime 전환 이전의 구 설계 잔재다.** 마지막 커밋이 2026-06-28(채린 초기 화면 구현)이고 그 뒤 수정이 없다. Realtime 모듈은 2026-07-30~08-03(유나)에 들어왔고, `webrtc-transport.ts`가 마이크를 직접 잡아(`getUserMedia({audio:true})`) OpenAI Realtime에 붙이며 `function-dispatcher.ts`가 `search_routes`·`create_trip`·`get_trip_status`·`end_trip`을 백엔드 REST로 넘긴다. **사용자 확인(2026-08-09): 구 STT/TTS 방향은 폐기이며 Realtime 실패 시에는 별도 오류 화면을 구현할 예정이다. 이 화면을 "미완성 기능"으로 취급하지 말 것.**
- **앱의 진짜 공백은 Realtime 모듈이 `App.tsx`에 연결되지 않은 것이다.** `App.tsx`와 7개 화면 어디에서도 `src/realtime/*`를 import하지 않는다(grep 확인). 서버 세션 발급 API는 준비돼 있으나 앱에서 실행 경로가 없다.

### 0.5 다음 세션이 지금 바로 할 수 있는 것

최우선 항목(ODsay)이 팀원 답장 대기라 막혀 있다. **승인 없이 지금 착수 가능한 것은 다음 둘뿐이다.**

1. **Realtime 세션 smoke 2단계** — 올바른 `REALTIME_SHARED_SECRET`으로 `200`·모델 `gpt-realtime-mini`·`expiresAt` 미래 확인. **시크릿을 에이전트 대화에 노출하지 말고 사용자가 직접 실행해 결과 3가지만 공유하는 방식을 권장한다.** 발급된 `clientSecret` 값은 출력·기록 금지. (6절 3번)
2. **`GET /api/beacons` 통합 검증** — 운영 DB 쓰기가 없어 승인 없이 가능한 유일한 gate다. (6절 5~9번)

ODsay 답이 오면 6절 1번으로 즉시 복귀한다.

---

## 0-1. 이전 판(2026-08-07)에서 바뀐 것

- **Render 배포 브랜치 전환이 완료돼 있었다(사용자가 이전에 수행). 이번 세션에서 배포된 코드로 직접 확인했다.** 배포 브랜치는 `claude/nice-archimedes-iv7iu0`이고, 8/7 21:33~21:34 KST에 `a5bfdd7`이 자동 배포됐다. 구버전(`yemo-develop`)은 `POST /api/routes/search`에서 mock 어댑터를 쓰기 때문에 요청과 무관하게 후보 2개를 반환하는데, 운영은 그렇지 않았다 — 실제 Kakao·ODsay 어댑터가 돌고 있음이 응답으로 확인됐다. **handoff 이전 판 6절 2번은 해소됐다.**
- **PR #15 병합됨 — 노선 검색 외부 API 실패를 로그로 드러낸다.** `search-routes.service.ts`의 `catch { }`가 오류 객체를 바인딩조차 하지 않아 AxiosError가 소멸했고, ODsay 어댑터는 인증 실패(HTTP 200 + error 본문)를 "후보 없음"과 같은 빈 배열로 반환했다. 그 결과 운영 502의 원인을 로그로도 밖에서도 알 수 없었다. TDD로 실패 테스트 6개를 먼저 작성해 고쳤다. 서버 테스트 98 → **104**. 공개 계약(502 / 200+빈 배열)은 바꾸지 않았다. 8/7 23:39:40 KST 병합(`2578183`), 23:40 KST 자동 배포 live. 상세는 3절.
- **PR #17 신규 — Task 16의 PR #3 충돌 해소본을 push하고 PR로 올렸다(이전 판의 최우선 미결).** 브랜치 `yemo/resolve-chaerin-frontend-conflict`. 통합 브랜치 최신분(`2578183`)까지 병합했고 충돌 0건. 서버 테스트 104/104, `pnpm -r typecheck` 3개 패키지 전부 통과, 서버 build 통과. **`MERGEABLE`/`CLEAN`. 병합은 사용자 몫이며, 병합 후 PR #3을 닫아야 한다.**
- **미결이던 `client.ts` 계약 주석 1줄은 복원했다**(`70fdae4`). 복원 결과 `client.ts`는 통합 브랜치와 **완전히 동일**해졌다 — Task 16이 "두 구현의 로직은 같고 주석만 달랐다"고 본 분석이 맞았다는 뜻이다.
- **PR #16 신규(문서 전용) — Windows curl 한글 인코딩 함정.** 아래 항목의 내용을 `docs/TROUBLESHOOTING.md`에 기록했다. `MERGEABLE`/`CLEAN`.
- **⚠️ 이번 세션에서 한 시간짜리 오진이 있었다. 다음 세션이 같은 함정에 빠지지 않도록 반드시 읽을 것.** 운영 `POST /api/routes/search`가 8/7 22:27 KST부터 모든 목적지에 502를 반환하기 시작한 것처럼 보였고, 재배포·환경변수 변경이 없었기에 "Kakao 쪽이 변했다"(쿼터·키 폐기·허용 IP 제한)로 판단했다. **전부 틀렸다. Windows Git Bash에서 curl 명령줄 인자로 넘긴 한글이 CP949로 깨져서 생긴 현상이었다.** 서버는 깨진 목적지로 Kakao를 검색했고 0건이 나와 `목적지를 찾을 수 없습니다`를 던졌다. 22:27이라는 "장애 시작 시각"은 내가 프로브 명령을 heredoc에서 인라인 인자로 바꾼 시각과 초 단위로 일치했다. **한글 본문은 반드시 stdin(`-d @-` + heredoc)이나 UTF-8 파일로 넘긴다.** Kakao 키·쿼터·IP, Render 설정은 전부 정상이다. `lessons.md`와 `docs/TROUBLESHOOTING.md`(PR #16)에 기록.
- **아직 안 끝난 진짜 질문: 노선 검색 후보가 0건이다.** 올바른 인코딩으로 4개 목적지(병점역후문/병점역/수원역/아주대학교)를 보내면 전부 `success:true`인데 `routes: []`다. Kakao는 정상이므로 원인은 둘 중 하나다 — ODsay 키 문제이거나, 어댑터의 MVP 필터(환승 없는 직행 1건만, 하차 정류장 0.7km 이내)가 전부 걸러내거나. **PR #15가 넣은 로그가 이걸 구분해준다**(6절 1번).

---

## 0-2. 이전 판(2026-08-06)에서 바뀐 것

- **Task 16(PR #3 프론트엔드 충돌 해소)을 실행해 완료했다. 단, 로컬 커밋까지다 — push하지 않았다.** 새 worktree `.worktrees/chaerin-frontend-merge`, 브랜치 `yemo/resolve-chaerin-frontend-conflict`에서 `origin/chaerin-develop`을 병합해 충돌 4건을 전부 해소했다. 커밋 `7881ad6`. 서버 테스트 98/98 pass, `pnpm -r typecheck` 3개 패키지 전부 통과, 서버 build 성공, 충돌 마커 0건. Implementer `DONE` → Reviewer `APPROVE` → Director 최종 검수 통과. 상세는 3절 Task 16, 남은 판단은 6-A절.
- **막혀 있던 결정 1(WebRTC 버전)이 사용자 승인으로 확정됐다: `claude` 쪽 정확 버전 고정 유지**(`@config-plugins/react-native-webrtc: 13.0.0`, `react-native-webrtc: 124.0.6`). git 이력으로 출처를 확인한 결과 그 고정 버전은 **유나(una7620)의 `6382d70`**에서 온 것이고 yemo 작업물이 아니다. PR #3 쪽 `^15.0.1`/`^124.0.8`은 채린이 BLE를 붙이며 함께 `pnpm add`해 그 시점 최신이 잡힌 정황이고, "13→15로 올리자"는 판단의 흔적은 어느 커밋에도 없다. 근거와 한계는 `.agent-loop/CURRENT_TASK.md` 2절에 기록.
- **이전 판이 "Task 12 운영 smoke로 WebRTC 버전이 검증됨"이라 적은 것은 과대평가였다. 정정한다.** Task 12가 확인한 건 서버 `POST /api/realtime/session`의 401/200 계약이고 앱의 WebRTC 연결이 아니다(5절 자신도 "WebRTC 연결은 백엔드 단독 불가"로 남겨뒀다). 게다가 Task 12는 유나 구조 확정으로 무효화됐다. **어느 쪽 버전도 실기 검증된 적이 없다.** 앱에서 Realtime 연결이 실패하면 이 조합을 1순위 용의선상에 둔다.
- **이전 판의 "`lessons.md`에 stash 사고를 아직 안 씀" 서술은 틀렸다. 이미 기록돼 있다.** `lessons.md`의 "2026-08-06 — `git stash -u`는 일부 실패해도 성공한 것처럼 보인다" 항목이 증상·원인·복구 절차까지 담고 있다. 그 사고 자체(untracked 파일 4종이 drop된 stash에 딸려 갔다가 dangling commit에서 전량 복구)는 이전 판 서술 그대로이며 **현재 파일은 전부 정상이다.**
- **PR #3은 여전히 `DIRTY`/`CONFLICTING`이다(2026-08-07 `gh pr view 3` 확인).** Task 16의 해소 결과는 `chaerin-develop`이 아니라 별도 브랜치에 있으므로, 커밋했다고 PR #3이 자동으로 풀리지 않는다. **이 결과를 PR #3에 어떻게 반영할지는 아직 결정되지 않았다(6-A.6절).**
- 이전 판의 나머지 내용(PR #13·#14 병합, GBIS `occupancy` 계약 등록)은 3절에 그대로 남아 있다.

---

## 1. 브랜치 구조와 Git 기준점

- 저장소: `yemoyang9-a11y/bus-ta`

| 브랜치 | 역할 | SHA (2026-08-08 15:20 UTC `ls-remote` 실측) |
| --- | --- | --- |
| `claude/nice-archimedes-iv7iu0` | **통합·배포·E2E 기준** | `b3e2245d5ede3dff48adc50d244592c9c14652c8` (2026-08-09 PR #18 병합분. 이전 `122e86de` = PR #16·#17) |
| `yemo-develop` | 개인 개발 브랜치(더 이상 배포 기준 아님) | `9b1fb092c41d9a47f13b2cdf7521a928899bf031` |
| `chaerin-develop` | PR #3 — 원본. **PR #3은 자동 `MERGED`됐다.** 원격 브랜치는 남아 있음 | `276e38ba6c416efa30296c3510fd77deaafb426c` |
| `yemo/resolve-chaerin-frontend-conflict` | PR #17 — **병합 완료**. worktree 제거 가능 | `02269d1` |
| `yemo/log-outbound-ip` | PR #18 — **병합 완료**(`b3e2245d`). worktree `.worktrees/outbound-ip`(node_modules 설치돼 있어 서버 테스트 즉시 실행 가능, 재사용 권장) | `183e8de` |
| `yemo/route-search-upstream-error-visibility` | PR #15 — **병합 완료**. worktree 재사용 중 | `4968097` |
| `yemo/troubleshoot-windows-curl-encoding` | PR #16 — **병합 완료**. worktree(`route-search-observability`)에 `node_modules`가 있어 서버 테스트용으로 재사용 중 | `6f9a6f8` |
| `yemo/merge-hyorin-integration` | PR #13 — **병합 완료**. worktree(`merge-hyorin`) 제거 가능 | `895d92bfe0a4911394a0c37b353bfbc1cc5f3ab9` |
| `yemo/route-search-multi-lane-candidates` | PR #14 — **병합 완료**. worktree(`route-lane-candidates`) 제거 가능 | `0abc8e5156e444049a21b316d796c533ed075f65` |
| `yemo/note-gbis-occupancy-checklist` | 문서 전용, **로컬에만 존재, 미커밋·미푸시** | 메인 checkout에 working tree 변경으로만 존재 |
| `yemo/be16-api-state-test-coverage` | 완료됨(PR #11로 병합) | `50834d48ab3933c9ef14f6d1452ec3cf713b6f39` |

- **PR #16·#17 병합 후 Render 재배포 여부는 이번 세션에서 확인하지 못했다**(대시보드 접근 불가). 자동 배포가 켜져 있고 두 PR 모두 서버 코드를 바꾸지 않았으므로(문서 + `apps/mobile`) 서버 동작에는 영향이 없다. 운영 health `200`/`UP`/`UP`은 확인했다.
- Render 배포 상태(2026-08-08 확인): **배포 브랜치는 `claude/nice-archimedes-iv7iu0`로 전환 완료.** 자동 배포가 켜져 있다(Events에 `New commit via Auto-Deploy`). 8/7 21:33~21:34 KST `a5bfdd7` 배포, 8/7 23:39~23:40 KST `2578183` 배포 live. **이 서비스의 빌드는 1분대에 끝난다** — 배포가 너무 빨리 끝난 것처럼 보여도 정상이다. `GET /api/health` `200` / `serverStatus UP` / `dbStatus UP` 확인.
- Free 인스턴스는 15분 무활동 시 잠들고, cold start에 25~45초가 걸린다. 첫 요청이 느리다고 장애로 오해하지 말 것.
- Render 서비스: `bus-ta`, `srv-d9or4mss728c73fo8i8g`, `https://bus-ta.onrender.com`

### 1.1 fetch refspec이 망가져 있다 (반드시 먼저 확인, 이전 판과 동일 문제)

```text
remote.origin.fetch = +refs/heads/claude/nice-archimedes-iv7iu0:refs/remotes/origin/claude/nice-archimedes-iv7iu0
```

이번 세션에서도 이 문제로 두 번 헛짚었다 — `claude` 브랜치가 push 없이도(다른 PR 병합으로) 두 번 움직였는데(`a718012` → `a5bfdd7`), `git fetch origin claude/nice-archimedes-iv7iu0`를 명시적으로 실행해야만 로컬이 따라갔다. `chaerin-develop`은 remote-tracking ref 자체가 없어서 `git fetch origin chaerin-develop:refs/remotes/origin/chaerin-develop --force`로 강제로 만들어야 했다.

**이 두 ref를 절대 판단 근거로 쓰지 마라.** 원격 진실은 `git ls-remote --heads origin`으로 확인하고, 비교가 필요하면 명시적으로 `git fetch origin <브랜치>:refs/remotes/origin/<브랜치> --force` 후 그 ref를 쓴다.

근본 수정(사용자 확인 후, 아직 미실행):

```bash
git config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git fetch origin --prune
```

### 1.2 worktree 구성

2026-08-09 08:32 UTC `git worktree list` 실측:

```text
한이음_프로젝트_폴더/                        yemo/note-gbis-occupancy-checklist (메인 checkout, a718012)
  └ REMAINING_CHECKLIST.md 편집 2건 미커밋. 다음 세션이 커밋 여부 판단.
    주의: 메인 checkout의 HEAD는 a718012(PR #13 병합분)로, 원격 claude head(122e86d)보다 여러 커밋 뒤다.
.worktrees/chaerin-frontend-merge/          yemo/resolve-chaerin-frontend-conflict (PR #17 병합 완료 → 제거 가능)
.worktrees/outbound-ip/                     yemo/log-outbound-ip (PR #18 병합 완료, 183e8de.
  └ node_modules 설치됨. 2026-08-09 의 108/108 실행을 여기서 했다. 가장 최신 base(122e86d) 기준이라 재사용 권장)
.worktrees/route-search-observability/      yemo/troubleshoot-windows-curl-encoding (PR #16 병합 완료.
  └ node_modules가 설치돼 있어 서버 테스트를 바로 돌릴 수 있다. 2026-08-08 의 104/104 실행을 여기서 했다)
.worktrees/yemo-develop/                    yemo/be16-api-state-test-coverage (완료됨. 이 handoff와 .agent-loop/의 위치)
.worktrees/merge-hyorin/                    yemo/merge-hyorin-integration      (PR #13 병합 완료 → 제거 가능)
.worktrees/route-lane-candidates/           yemo/route-search-multi-lane-candidates (PR #14 병합 완료 → 제거 가능)
.worktrees/migration-history-sync/          yemo/migration-history-sync
.worktrees/sec01-security-followups/        yemo/sec01-security-integration
(그 외) AppData/Local/Temp/bus-ta-sec01-doc-contract-sync   yemo/sec01-doc-contract-sync
(그 외) .worktrees/yemo-develop/.codex/worktrees/sec01-security-contract-fix  yemo/render-deployment-readiness
```

**현재 세션이 있던 worktree는 `.worktrees/yemo-develop`이고 브랜치는 `yemo/be16-api-state-test-coverage`(PR #11로 이미 병합된 완료 브랜치)다.** DIRECTOR.md 규칙상 루프 전용 feature 브랜치가 아니므로 여기서 커밋·push하면 안 된다. **코드 작업이 필요해지면 `claude` 최신 SHA 기준으로 새 worktree·브랜치를 만든다.**

미커밋 파일(2026-08-09 08:32 UTC `git status --short`): `M CLAUDE.md`, `M personal-notes/CODEX_HANDOFF.md`, `?? .agent-loop/`, `?? .codex/`, `?? lessons.md`. **이번 세션에서 `lessons.md`·`.agent-loop/CURRENT_TASK.md`·이 handoff 를 갱신했고 전부 미커밋이다.**

`.worktrees/yemo-develop`의 미커밋 파일(`M CLAUDE.md`, `M personal-notes/CODEX_HANDOFF.md`, `?? .agent-loop/`, `?? lessons.md`)과 메인 checkout의 미커밋 파일은 사용자·에이전트 제어 자료다. 일괄 restore, clean, stage, commit하지 않는다.

---

## 2. 우선 읽을 문서

1. `AGENTS.md`
2. `CLAUDE.md`
3. `.agent-loop/DIRECTOR.md`
4. `.agent-loop/CURRENT_TASK.md` — **Task 21(outbound IP 로깅, `COMPLETE`)과 Task 19(노선 검색 후보 0건 진단, `해소됨`)**. 두 Task 모두 끝났으므로 다음 세션은 0.5절에서 다음 작업을 선정해 이 파일을 새로 쓴다. 진단 경위와 배제된 가설은 판단 근거로 보존돼 있다.
5. 이 `personal-notes/CODEX_HANDOFF.md`
6. `lessons.md`
7. `personal-notes/REMAINING_CHECKLIST.md` — GBIS occupancy, PR #3 진단 요약이 여기도 있다
8. 노션 「백엔드 개발 명세서」와 그 1장이 지정한 계약 문서들

계약 충돌 시 사용자 현재 지시 → 「공통 API 및 Function Calling 명세서」 → 「공통 데이터 모델 및 상태 명세서」 7장 → 「GPT-Realtime mini 개발 가이드」·「프론트엔드 개발 지침서」 → 「한이음 시스템 전체 흐름 및 역할 분담 문서」 순서로 판단하고 충돌을 숨기지 않는다.

로컬 `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`와 노션 구버전 문서는 계약 판단 기준으로 쓰지 않는다.

---

## 3. 완료된 작업

### Task 11 — Render 배포 (`DEPLOYED_COMPLETE`)

- 서비스 `bus-ta`, 배포 ID `dep-d9pf71rl550s73bhrh70`, 배포 커밋 `9b1fb092...`
- 운영 Health: HTTP `200`, `serverStatus = UP`, `dbStatus = UP`
- Free 인스턴스 cold start는 30~60초 이상 걸릴 수 있다.

### Task 12 — 보호된 Realtime 세션 smoke (`COMPLETE`, 그러나 무효화됨 — 6절 참고)

- Codex 환경, 세 역할 모두 `gpt-5.6-luna / xhigh`. Implementer `DONE`, Tester `PASS`, Reviewer `APPROVE`
- 무인증 `401 UNAUTHORIZED`, 보호 요청 `200`, 모델 `gpt-realtime-mini`, `expiresAt` 미래
- Realtime 라우트 테스트 `12/12 PASS`
- **이 검증은 yemo 구현(어댑터·서비스 분리 구조)을 상대로 한 것이었다. Task 15에서 통합 브랜치의 Realtime 구현이 유나 쪽 구조로 확정되면서 이 증거는 더 이상 배포될 코드를 커버하지 않는다. Render 브랜치 전환 후 재실행 필요.**

### Task 13 — 운영 REST ↔ Supabase E2E (`COMPLETE`)

- Claude Code 세션. Director `claude-opus-5`, 서브에이전트 `claude-sonnet-5`.
- verifier 1회 실행, exit `0`, `status = PASS`
- Health `200 UP/UP` → 생성 `201` → 위치 PATCH `11/11`(고유 `requestId` 11) → 하차벨 트리거 정확히 1회 → 결과 `SUCCESS` → `TRIP_DONE`/`remainingStations = 0`
- Supabase exact-ID 집계 `1 / 1 / 11 / 1`, 서버 typecheck `0`, 대상 6개 파일 `52/52 PASS`
- 정리: 이번 Task의 test 운행 2건 + 이전 데모 잔존 운행 `trip-demo-1551-1782817453748` 삭제 완료
- **정리 시점 운영 행 수: `trips = 0`, `trip_status = 0`, `location_logs = 0`, `bell_logs = 0`, `bus_beacons = 1`** (이후 세션에서 운영 DB 쓰기는 없었음)
- 교훈: `mcp__supabase__list_tables`의 행 수는 `live_rows_estimate` 추정치다. `select count(*)`를 쓴다. `lessons.md` 참고.

### Task 14 — `yemo-develop` → `claude` 통합 병합 (`MERGED`, PR #13으로 이어짐)

- Claude Code 세션. Director `claude-opus-5 / high`, Implementer·Tester·Reviewer `claude-sonnet-5`.
- 브랜치 `yemo/merge-hyorin-integration`, 커밋 `9d5ef09`(부모 `382db3c`, `9b1fb092`), 42개 파일 변경.
- 효린의 실제 Kakao·ODsay·GBIS 어댑터, Realtime 세션(yemo 구현), SEC-01 보안, API 테스트를 한 브랜치에 모았다.
- PR #13 생성 시점엔 `MERGEABLE`이었으나 이후 `claude`에 유나의 PR #4(Realtime 독립 구현)가 병합돼 충돌 발생 → Task 15로 이어짐.

### Task 15 — `RESOLVE-REALTIME-MERGE-CONFLICT` (`COMPLETE`, 2026-08-06)

PR #13이 Realtime 6개 파일 충돌(`index.ts`, `routes/realtime.ts`, `realtime.test.ts`, `realtime.schema.ts`, `shared/index.ts`, `API_SPEC.md`)로 막혀 있었다. yemo 구현과 유나 구현이 같은 `POST /api/realtime/session`을 각자 만들었고, 오류 계약이 정반대였다(`OPENAI_API_KEY` 미설정을 yemo는 `502`, 유나는 `401`로; `REALTIME_SHARED_SECRET` 미설정을 yemo는 `401`, 유나는 `500 SERVER_CONFIG_ERROR`로).

**결정 (사용자 승인)**

1. 오류 계약은 노션 「공통 API 및 Function Calling 명세서」 6.1장 기준으로 확정 — `401 UNAUTHORIZED`(공유 시크릿 문제), `502 REALTIME_SESSION_FAILED`(OpenAI 문제). `SERVER_CONFIG_ERROR`는 계약에 없어 폐기.
2. 유나의 구현 **구조**는 유지하고 오류 계약만 교정 — 이미 리뷰돼 통합 브랜치에 병합된 팀원 PR을 되돌리는 게 아니라 계약 위반만 고치는 것이므로.

**실행**

- worktree `.worktrees/merge-hyorin`, 브랜치 `yemo/merge-hyorin-integration`에서 `git merge bc5f721...` 실행. 실제 충돌 6건이 예측과 정확히 일치.
- 1회차 Reviewer가 `REJECT` — `docs/DEVELOPMENT_RULES.md` 37행이 "시크릿 미설정은 서버 설정 오류"라고 적어 확정 계약(401)과 모순됨을 발견. Director가 직접 이 줄이 병합으로 새로 들어왔음을 확인.
- 2회차에서 그 한 줄만 교정(`895d92b`), Reviewer `APPROVE`.
- 커밋: `04a60ae`(머지) + `895d92b`(문서 교정). 서버 테스트 93/93 pass, typecheck·build 통과. push 후 PR #13이 `MERGEABLE`로 복귀, 사용자가 병합(`a718012`, 2026-08-06 10:54 UTC).
- **부산물 교훈(검증됨, `lessons.md` 기록)**: 환경변수 "미설정" 테스트에서 기본 매개변수가 있는 곳에 `undefined`를 명시로 넘기면 기본값이 되살아난다(`null` sentinel로 해결). barrel(index) 파일 충돌은 파일 단위로 한쪽을 통째로 채택하면 무관한 export가 조용히 사라질 수 있다(줄 단위 대조 필요).

### Task (번호 미부여) — 노선 후보 다중화 (`COMPLETE`, PR #14, 2026-08-06)

효린 어댑터를 실제 Kakao·ODsay·GBIS 응답으로 검증하다가(사용자가 바탕화면 텍스트 파일로 실캡처 3건 제공), `hyorin-route-search.adapter.ts`의 `searchRoutes()`가 `subPath.lane[0]`만 후보로 만드는 버그를 발견했다. 실제 캡처에서 한 `subPath`를 버스 4개(34/34-1/46/1000)가 공유했는데, 코드가 고르는 34번은 그 시점 GBIS 실시간 정보가 없어(`predictTime1: ""`) `predictedArrivalMinutes: null`이 됐지만, 같은 정류장을 지나는 1000번은 37분 후 도착 정보가 있었다. 즉 후보 생성 단계에서 이미 유효한 대안이 걸러지고 있었다.

TDD로 수정: `subPath` 공통 계산(정류장·거리 필터)은 `lane` 순회 밖으로, `candidates.push()`를 `lane` 개수만큼 실행하도록 변경. 새 테스트 5개(fixture 3개는 실제 API 응답)가 `RouteCandidateSchema` 계약 통과까지 검증한다.

- 브랜치 `yemo/route-search-multi-lane-candidates`, 커밋 `0abc8e5`. 서버 테스트 93→98(신규 5개), typecheck·mobile typecheck·build 통과.
- PR #14, base `claude/nice-archimedes-iv7iu0`, 2026-08-06 12:33 UTC 사용자 병합(`a5bfdd7`).
- **범위 밖으로 남긴 것(후속 검토 필요, 미착수)**: `getArrivalInfo()`의 `arrivals.find()`가 같은 `routeId`가 GBIS 응답에 두 번 나올 때(순환노선 등) 첫 항목만 봐서 뒤쪽 유효한 값을 놓칠 수 있다. Kakao geocoding이 `documents[0]`을 무조건 신뢰해 모호한 검색어에서 엉뚱한 결과를 고를 위험도 미검토.

### Task 16 — `RESOLVE-CHAERIN-FRONTEND-PR-CONFLICT` (`MERGED` — PR #17로 병합 완료, 2026-08-07)

PR #3(채린, `chaerin-develop`)의 병합 충돌을 해소했다. Claude Code 세션, Director `claude-opus-5`, Implementer·Reviewer 서브에이전트 `claude-sonnet-5`(2-에이전트 구성).

**사전 결정 (사용자 승인)**: WebRTC 두 패키지는 `claude` 쪽 정확 버전 고정 유지. 배경은 0절.

**실행**

- worktree `.worktrees/chaerin-frontend-merge`, 브랜치 `yemo/resolve-chaerin-frontend-conflict`를 `a5bfdd7` 기준으로 새로 만들고 `git merge origin/chaerin-develop` 실행.
- 실제 충돌은 예측한 4개 파일(`app.json`, `package.json`, `client.ts`, `pnpm-lock.yaml`)과 **정확히 일치**. 해소 규칙은 6-A절과 CURRENT_TASK.md 지시대로 — `app.json`은 union, `package.json`은 합집합 + WebRTC만 claude 고정, `client.ts`는 claude 기준 + `apiClient.realtime` 유지, lock은 `pnpm install`로 재생성.
- `pnpm install --frozen-lockfile`이 WebRTC 버전 불일치로 실패해 `--no-frozen-lockfile`로 재생성했다(Implementer 명시 보고). 재생성 후에는 `--frozen-lockfile`이 `Already up to date`로 통과함을 Reviewer가 확인.
- 커밋 `7881ad6`. **push하지 않았다.**

**검증 (Implementer 실행 + Reviewer 독립 재실행, 수치 일치)**

- 서버 테스트 `98/98 pass, 0 fail` — 병합 전과 동일
- `pnpm -r typecheck` — `packages/shared`, `apps/server`, `apps/mobile` 전부 통과
- `pnpm --filter @bus-ta/server build` 성공
- 충돌 마커 0건, `apps/server`·`packages/shared` 변경 0건, 시크릿 노출 0건

**치명적 손실 검사 (전부 통과)**: `client.ts:117-125`에 `apiClient.realtime.createSession` 온전, `session.ts:21`이 실제 호출. `package.json:21`에 `expo-constants: ~18.0.13` 유지. WebRTC `13.0.0`/`124.0.6` 고정. `MOCK_*` grep 0건 + 4개 화면 `apiClient.*` 사용(PR #3 목적 생존). `app.json`에 마이크·블루투스 권한, 양쪽 플러그인, `extra.eas.projectId` 전부 존재하며 유효 JSON.

**Director 검수에서 나온 것 — Reviewer가 놓친 사소한 손실 1건**

`client.ts`의 실질 변경은 base 대비 `-1줄`이 전부인데, 그 한 줄이 claude 쪽 주석이었다.

```
-      // 하차벨 요청은 PATCH /status 응답으로 자동 생성되므로 별도 request 호출이 없다.
```

기능 손실이 아니고 같은 계약이 프로젝트 지침에도 있지만, "`ApiError`/`request()`는 claude 기준" 지시에서 이 줄만 PR #3 쪽이 채택된 결과다. `bell.result`만 있고 `bell.request`가 없는 이유를 코드에서 알려주던 줄이라 복원 가치가 있다. **Reviewer는 "발견한 문제 없음"으로 보고했다 — 이 범위에서 부정확하다.** 복원 여부는 미결(6-A.6절).

**문서 부정확 정정**: Task 16과 이전 판 6-A절이 PR #3을 "화면 4개"로 적었으나 실제로는 `ErrorScreen.js`(접근성 개선)와 `eas.json`(신규)까지 왔다. 둘 다 채린의 `1148f74`에서 온 정상 병합분이고 충돌도 없었다. 범위 밖 변경이 아니라 문서 서술이 부족했던 것이다.

**Reviewer가 스스로 밝힌 한계**: `--frozen-lockfile`이 병합 도중 실제로 실패했었는지는 재현하지 않고 Implementer 보고를 신뢰했다(lock이 이미 재생성된 뒤라 사후 재현 불가). 앱 기동·런타임 동작은 Task 범위 밖.

### Task 17 — 노선 검색 외부 API 실패 가시화 (`MERGED`, PR #15, 2026-08-07)

Render 배포 브랜치 전환 여부를 확인하려고 운영 `POST /api/routes/search`를 호출하다가, 502가 나는데 **원인을 로그로도 밖에서도 알 수 없는** 상태를 발견했다. 원인은 두 곳이었다.

1. `search-routes.service.ts`의 `catch { }` — 오류 객체를 **바인딩조차 하지 않아** AxiosError가 소멸. 서버에 요청 로거도 없어 Render 로그에 흔적이 전혀 남지 않는다.
2. `hyorin-route-search.adapter.ts`의 `if (!res.data.result) return []` — ODsay는 키가 틀려도 **HTTP 200 + error 본문**을 준다(직접 확인: `{"error":[{"code":"500","message":"[ApiKeyAuthFailed] ApiKey authentication failed."}]}`). 그래서 인증 실패가 "후보 없음"과 똑같은 빈 배열이 된다.

**수정 (공개 계약 불변)**: Kakao/ODsay 호출을 감싸 `upstream`(`KAKAO`/`ODSAY`)과 HTTP `status`를 담은 오류를 던지고, 502 응답 전에 `[routes/search] 외부 API 요청 실패 upstream=... status=... message=...`를 남긴다. ODsay 응답에 `result`가 없으면 `[routes/search] ODSAY 응답에 result 가 없다 code=... message=...`를 남긴다. 502 `ROUTE_SEARCH_FAILED`도 `200 + 빈 배열`도 그대로다.

**보안**: `AxiosError.config`에는 요청에 쓴 API 키가 헤더·params로 들어 있다. 오류를 통째로 찍으면 키가 샌다. 그래서 원본 AxiosError를 `cause`로도 넘기지 않고, 이 규칙이 깨지는지 검사하는 테스트를 2개 넣었다.

- TDD. 실패 테스트 6개를 먼저 작성해 전부 실패를 확인한 뒤 구현. 서버 테스트 98 → `104/104 pass`. `tsc --noEmit` 3개 패키지 exit 0, 서버 build exit 0.
- 커밋 `4968097`, PR #15, 8/7 23:39:40 KST 병합(`2578183`), 23:40 KST 배포 live.
- **부산물 교훈(검증됨)**: 테스트에서 `JSON.stringify(error, Object.getOwnPropertyNames(error))`로 키 노출을 검사하려 했더니 처음부터 통과했다. 2번째 인자로 배열을 주면 **replacer 배열**이 되어 모든 depth에서 그 키 목록만 남기므로 `config.headers.Authorization`이 걸러진다. 중첩 값 노출 검사에 이 패턴을 쓰면 안 된다. `error.config === undefined`처럼 구조를 단언하는 쪽으로 바꿔 실패를 확인했다.
- **범위 밖으로 남긴 것**: `getBusArrivalByStationId`(GBIS)에는 같은 처리를 하지 않았다. `predictedArrivalMinutes`가 `null`일 때 원인을 여전히 알 수 없다.

### Task 18 — PR #3 충돌 해소본 push·PR (`MERGED`, PR #17 → `122e86de`, 2026-08-08)

Task 16 결과(`7881ad6`)를 원격에 올리고 PR로 만들었다. 이전 판 6-A.6의 세 선택지 중 **1번(새 PR)**을 사용자가 선택했다.

- 미결이던 `client.ts` 계약 주석 1줄 복원(`70fdae4`, 기존 커밋 amend 금지 규칙 준수). 복원 결과 `client.ts`가 통합 브랜치와 **완전히 동일**해졌다.
- 통합 브랜치 최신분 `2578183` 병합(`02269d1`), 충돌 0건.
- 검증: 서버 `104/104 pass`, `pnpm -r typecheck` 3개 패키지 통과(**`apps/mobile`이 핵심 게이트**), 서버 build exit 0, `pnpm install --frozen-lockfile` → `Already up to date`, 충돌 마커 0건.
- 통합 브랜치 대비 변경 파일 9개(+250/−295), 전부 `apps/mobile` + lockfile. **서버·shared 변경 0건.**
- 치명적 손실 재확인: `apiClient.realtime` 존재, `expo-constants ~18.0.13` 존재, WebRTC `13.0.0`/`124.0.6` 고정 유지.
- 상태 `MERGEABLE`/`CLEAN`. **병합 후 PR #3을 닫아야 한다.**

### Task 19 — 노선 검색 후보 0건 진단 (`ROOT_CAUSE_LOCALIZED_TO_ODSAY`, 2026-08-08)

코드 변경 없는 순수 진단 Task. Claude Code 세션, Director만 사용(서브에이전트 0개 — 진단은 분할할 독립 작업이 없어 루프를 돌리지 않았다).

handoff 이전 판은 "Render 로그를 봐야 갈린다"고 했지만, 어댑터를 먼저 읽고 **로그 없이 배제 가능한 것부터 처리**했다. 프로브 7건(지역·거리·노선 밀도를 흩은 조합)이 전부 0건이고 502가 없어 Kakao 성공이 확인됐으며, 실제 캡처 fixture로 어댑터 필터가 정상 동작함을 테스트와 직접 파싱으로 확인했다. 그 뒤 사용자가 확인해준 로그 값 `code=500 message=[ApiKeyAuthFailed] ...`으로 ODsay 키 인증 실패가 확정됐다.

- 실측·가설·확인 절차 전체: `.agent-loop/CURRENT_TASK.md`
- 재사용 프로브: `.agent-loop/probe-routes.sh`
- **남은 것**: ODsay 콘솔에서 키 종류(Server/Web)와 등록 IP 확인. 담당 팀원 답장 대기 중.
- **부산물(검증됨)**: axios `1.18.1`의 `params` 직렬화는 값마다 `encodeURIComponent`를 적용한다. 이미 URL 인코딩된 키를 환경변수에 넣으면 `%2B` → `%252B`로 이중 인코딩돼 인증이 깨진다. 반대로 ODsay가 경고하는 "`+` 미인코딩" 실패는 axios를 쓰는 한 발생하지 않는다. **키 값을 보지 않고 `%` 유무만으로 판별할 수 있다.**

### ✅ 노선 검색 후보 0건 — 해결됨 (2026-08-09 08:14 UTC)

**원인은 ODsay 등록 IP 불일치였고, 서버 코드는 처음부터 정상이었다.** Task 21(PR #18)이 배포처의 outbound IP 를 로그로 드러냈고, 사용자가 그 값을 ODsay 콘솔에 등록하자 프로브 6건이 **전부 후보를 반환했다.**

| 프로브 | 결과 |
| --- | --- |
| 수원대 → 수원역 | 후보 2건 (1007, 700-2) |
| 수원대 → 병점역 | 후보 2건 (1551, 1551B) |
| 수원역 → 아주대학교 | 후보 2건 (32-4, 80) |
| 아주대 → 수원역 | 후보 2건 (13-4, 720-2) |
| 강남역 → 양재역 | 후보 2건 (서초09, 405) |
| 병점역 → 수원역 | 후보 1건 (301) |

응답 시간 1~3초. **PR #14(`subPath` 하나를 여러 버스가 공유하면 노선마다 별도 후보)도 이 프로브로 처음 실제 검증됐다** — 수원대→병점역의 1551 / 1551B 가 정류장 목록·소요시간·거리가 완전히 같고 `routeNo` 만 다른 두 후보로 나왔다. 같은 `subPath` 를 공유하는 `lane` 이 각각 후보가 된 것이 정확히 그 동작이다.

> **⚠️ 남은 위험: Render 무료 플랜의 outbound IP 는 고정이 보장되지 않는다.** 대역이 두 개 공지된다는 것 자체가 그 안에서 바뀔 수 있다는 뜻이고, 무료 인스턴스는 15분 무활동으로 잠들었다 깨며 재스케줄된다. **IP 가 바뀌면 노선 검색이 다시 통째로 죽는데 증상이 502 가 아니라 "그냥 결과가 없다"라서 현장에서 알아채기 어렵다.** cold start 마다 `[startup] outbound ip=` 가 새로 찍히므로 **시연 전 이 값이 ODsay 등록값과 같은지 반드시 확인한다.** 근본 해결은 ODsay 에 대역(CIDR) 등록이 가능한지 문의하는 것이다(미발송 시 아직 유효한 후속 과제).

### Task 21 — 부팅 시 outbound IP 로깅 (`COMPLETE` — PR #18 병합 `b3e2245d`, 2026-08-09)

Task 19의 (c) 등록 IP 불일치가 확정됐지만 **무료 해결 경로를 시도할 수단 자체가 없어서** 만든 진단 도구다. ODsay는 등록 IP 에서 온 호출만 받는데 Render 는 개별 주소가 아니라 대역(`74.220.52.0/24`, `74.220.60.0/24`)만 알려주고, 등록 IP 목록을 비우는 것도 최소 1개 강제로 막혀 있으며, Supabase 로그에는 클라이언트 IP 필드가 없다(실측).

부팅 시 공인 IP 를 1회 조회해 `[startup] outbound ip=...` 를 남긴다. Render 무료 인스턴스는 cold start 마다 재시작하므로 이 줄이 매번 새로 찍히고, 값이 유지되는지로 "그 IP 등록으로 해결되는가 / 고정 IP 가 필요한가"가 갈린다.

- TDD. 시그니처 스텁 상태에서 신규 테스트 4개가 각각 기대한 assertion 으로 실패하는 것을 확인한 뒤 구현했다.
- 서버 테스트 104 → **108/108 pass**, `pnpm -r typecheck` 3개 패키지 통과, 서버 build exit 0, 실제 조회 함수가 IPv4 를 반환하는 것까지 로컬 확인.
- 브랜치 `yemo/log-outbound-ip`, worktree `.worktrees/outbound-ip`, 커밋 `183e8de`. **PR #18 병합됨(`b3e2245d`, 2026-08-09T08:06:36Z). 자동 배포 후 로그에 값이 정상적으로 남는 것을 사용자가 확인했다.**
- **공개 API 를 추가하지 않았다**(명세에 없는 엔드포인트 신설 금지). 계약 문서 변경 0건. 기존 9개 API 동작 불변.
- 보안: 조회 서비스 응답은 외부 입력이므로 IPv4 형태가 아니면 원문을 로그에 남기지 않는다(개행을 심어 가짜 로그 줄을 만드는 것을 막는다). 테스트로 강제.
- **미검증**: 배포 환경에서 실제로 이 줄이 찍히는지는 병합·배포 후에만 확인된다.
- **병합 후 순서**: Render Logs 에서 `[startup] outbound ip=` 검색 → 그 IP 를 ODsay 콘솔에 등록 → `.agent-loop/probe-routes.sh` 재실행 → 며칠간 cold start 마다 같은 값인지 관찰.

### Task 20 — Realtime 세션 smoke 1단계 재검증 (`PARTIAL`, 2026-08-08)

배포본 `122e86de` 대상. 무인증 호출과 오시크릿 호출 모두 `401 UNAUTHORIZED` 확인. 2단계(보호 요청 `200`)는 시크릿 취급 문제로 미실행. 상세와 한계는 0.3절·6절 3번.

### 노션 계약 등록 — GBIS `occupancy`(혼잡도·잔여좌석) (`문서 완료`, 코드 `미착수`)

효린이 GBIS 응답의 혼잡도·잔여좌석 파싱을 끝내고 공유한 메모(`type: CONGESTION | REMAINING_SEATS | UNAVAILABLE`, `congestionLevel 1~4`, `remainingSeats`)를 바탕으로, 사용자가 "가장 먼저 도착하는 차량뿐 아니라 두 번째 도착 차량까지 배열로 준다"를 확정했다. 「공통 API 및 Function Calling 명세서」 5.2-A로 등록(2026-08-06) — `create_trip` 응답의 `predictedArrivalMinutes` 단일 필드를 `arrivals` 배열로 교체하는 계약이다.

- **문서 상태를 "계약 확정, 코드 미반영"으로 명시했다.** 이 절이 구현되기 전까지는 기존 `predictedArrivalMinutes` 단일 필드가 실제 동작 중인 계약이다.
- 코드 대조로 확인한 것: GBIS 실패 시 운행 생성이 그대로 진행되는 원칙은 `create-trip.service.ts`의 기존 `readPredictedArrivalMinutes` try/catch 패턴과 이미 일치. 반대로 "5초 timeout"은 `hyorin-route-search.adapter.ts`의 axios 호출에 없음을 직접 grep으로 확인해 "미구현"으로 명시.
- **미결**: 숫자만 줄지 "여유"/"혼잡" 라벨도 줄지 유나 확인 필요 (5.2-A 체크박스로 남김).
- 체크리스트 항목: `personal-notes/REMAINING_CHECKLIST.md` B절.

---

## 4. 현재 구현 상태 (`claude` head `b3e2245d` 기준, 2026-08-09 실측)

### 공개 API 9개 — 전부 구현 + 테스트

| API | 상태 |
| --- | --- |
| `GET /api/health` | 구현·테스트. shared `HealthResponse` 계약 사용 |
| `POST /api/routes/search` | 구현·테스트. **실제 Kakao + ODsay 연동. 2026-08-09 운영 프로브 6건 전부 후보 반환 확인.** `subPath.lane` 전체를 후보로 만드는 PR #14 동작도 이때 실물 검증됐다 |
| `POST /api/trips` | 구현·테스트. **실제 GBIS 도착정보 연동.** `predictedArrivalMinutes`는 아직 단일 값(occupancy 확장은 미구현) |
| `PATCH /api/trips/{tripId}/status` | 구현·테스트 |
| `GET /api/trips/{tripId}/status` | 구현·테스트 |
| `POST /api/trips/{tripId}/bell/result` | 구현·테스트 |
| `PATCH /api/trips/{tripId}` (`action: CANCEL`) | 구현·테스트 |
| `GET /api/beacons` | 구현·테스트 |
| `POST /api/realtime/session` | 구현·테스트. **유나 구조 + yemo 오류 계약(Task 15).** |

서버 테스트 총 **108개**(PR #18 이 4개 추가). 2026-08-09에 `.worktrees/outbound-ip`에서 직접 실행해 **108/108 pass** 확인했다. 이전 판의 104/104 는 `122e86d` 기준 수치다.

### 앱(`apps/mobile`) 현황 — 2026-08-08 통합 브랜치 실측

백엔드 판단에 영향을 주는 범위만 적는다. 앱 구현 자체는 채린·유나 담당이다.

- **화면 7개**(`Main`/`STT`/`Confirm`/`RouteList`/`Riding`/`Alight`/`Error`)가 `App.tsx` 스택 네비게이터에 등록돼 있다.
- **백엔드 연동은 실제로 붙었다.** 4개 화면이 `apiClient`로 호출하고, 위치는 `expo-location` 실제 GPS다(하드코딩 좌표 아님). PR #3 병합분.
- **`STTScreen.js`는 구 설계 잔재다**(0.4절). Realtime 전환 이전 코드이며 폐기 방향으로 사용자 확인됨.
- **Realtime 모듈이 앱에 연결돼 있지 않다.** `src/realtime/` 아래 `session.ts`·`webrtc-transport.ts`·`function-dispatcher.ts`·`guide.ts`가 다 있지만 `App.tsx`와 7개 화면 어디에서도 import하지 않는다. **서버 세션 발급 API는 준비됐는데 앱에 실행 경로가 없다** — 백엔드 입장에서 이게 Realtime E2E를 막는 지점이다.
- **하차벨은 앱이 mock 결과를 만들어 보낸다.** `AlightScreen.js`가 `isMock: true`로 성공 결과를 전송하고 주석에 `TODO(Phase 7): 실제 BLE 스마트지팡이 결과로 대체`가 남아 있다. `react-native-ble-plx ^3.5.1`은 설치됐으나 화면에서 쓰이지 않는다.
- 하드웨어: `hardware/bus-beacon/ble_scan.ino`, `hardware/smart-cane/ble_stick.ino`는 있고 **`hardware/smart-bell`은 README만 있고 `.ino`가 없다.**

테스트 실행 명령(스크립트가 없다. CI는 typecheck만 돌린다):

```bash
cd apps/server && node --import tsx --test $(find src -name '*.test.ts')
```

### 외부 서비스 연동

`apps/server/src/adapters/`:

- `routes/hyorin-route-search.adapter.ts` — **실제 호출.** 목적지→좌표(Kakao), 좌표→경로 후보(ODsay), 도착 예정 시간(GBIS). 환승 없는 직행 버스만, 하차 정류장이 목적지에서 0.7km 초과면 제외. **`subPath` 하나가 여러 버스 노선을 공유하면 노선마다 별도 후보를 만든다(PR #14).**
- `routes/mock-route-search.adapter.ts` — 남아 있지만 라우트에서 쓰이지 않음
- `realtime/`: 유나 쪽 구조(`services/realtime/config.ts`, `create-realtime-session.service.ts`)로 확정. yemo 쪽 파일(`realtime-session.service.ts`, `adapters/realtime/openai-realtime.adapter.ts`, `shared/constants/realtime.ts`)은 Task 15에서 삭제됨.
- `bell/mock-bell.adapter.ts`

### Migration

저장소에 7개, `20260701`부터 `20260805045657_restrict_future_data_api_access`까지 원격 적용 확인됨(이전 판과 동일, 이번 세션에서 변경 없음).

---

## 5. E2E 검증 가능 범위

명세 단계 16.4 기준.

| 항목 | 상태 |
| --- | --- |
| 실제 REST 요청과 Supabase row 함께 확인 | **완료** (Task 13) |
| 실제 Kakao + ODsay 로 노선 후보 생성 | **완료 (2026-08-09).** 운영 프로브 6건 전부 후보 반환. `subPath` 공유 시 노선별 후보 분리(PR #14)도 함께 확인 |
| 후보 → `POST /api/trips` → GBIS 도착 예정 시간 | **미실행.** 운영 DB 쓰기라 사전 승인 필요. 6절 4번 |
| migration 작성과 실제 적용 분리 기록 | **완료** |
| Realtime Function 결과가 프론트엔드 Dispatcher를 거쳐 모델에 전달 | 백엔드 단독 불가 — 앱 책임 |
| PATCH `shouldTriggerBell: true`가 BLE/mock 흐름으로 한 번만 전달 | 부분 — 백엔드 측 1회 생성은 검증됨 |
| Realtime 세션 운영 smoke (무인증 401, 보호 200) | **부분 완료 (2026-08-08).** 무인증·오시크릿 `401 UNAUTHORIZED` 재검증 완료(배포본 `122e86de`). 보호 요청 `200`은 미실행 — 시크릿 취급 때문에 사용자 실행 권장. 6절 3번 참고 |

여전히 백엔드 단독 불가: WebRTC 연결과 Function Dispatcher(앱), BLE 실제 진동(하드웨어).

---

## 6. 남은 작업 (우선순위 순)

### 1. ~~ODsay 키 인증 해결~~ — **✅ 해결됨 (2026-08-09). 상세는 3절 상단.**

> 원인은 등록 IP 불일치였다. Task 21(PR #18)로 배포처 outbound IP 를 로그에 드러내고 그 값을 ODsay 에 등록해 풀었다. 프로브 6건 전부 후보 반환 확인. **서버 코드는 고친 것이 없다.**
>
> **남은 후속 둘.** ① Render 무료 outbound IP 는 고정이 아니므로 **시연 전 `[startup] outbound ip=` 재확인** 필요. ② 근본 해결로 ODsay 에 대역(CIDR) 등록 가능 여부 문의.
>
> 아래는 진단 경위 기록으로 보존한다.

> **2026-08-08 확정**: 원인은 ODsay `ApiKeyAuthFailed`다(0.2절). **서버 코드는 고칠 것이 없다.** 남은 확인은 ODsay 콘솔의 키 종류(Server/Web)와 등록 IP이며 담당 팀원이 확인 중이다.
>
> **답이 오면 할 일:**
>
> - **(a) Web 키였다면** → Server 키 재발급 → Render `ODSAY_API_KEY` 교체 → `.agent-loop/probe-routes.sh` 재실행으로 후보 생성 확인 → 6절 4번(실제 외부 API E2E)으로 진행.
> - **(c) IP 불일치였다면** → 무료 플랜에서 막힐 수 있다. 선택지는 셋이며 전부 사용자 결정 사항이다. ① ODsay가 CIDR 등록을 받아주는지 확인(가능하면 Render 대시보드 `Connect` → `Outbound`의 대역 등록), ② Render 유료 dedicated IP set, ③ 고정 IP 프록시 경유. **이 판단 전에 코드를 고치지 않는다.**
> - 어느 쪽이든 해결 직후 프로브 재실행이 첫 검증이다. 후보가 나오면 그때부터 `subPath` 하나가 버스 여러 대를 공유할 때 후보가 여러 개 나오는지(PR #14 검증)도 함께 본다.
>
> 아래는 이 진단에 도달하기까지의 원래 판단 근거로 남겨둔다.

올바른 인코딩(heredoc)으로 목적지 4개를 보내면 전부 `success:true` + `routes: []`다. Kakao는 정상 동작하므로 원인은 둘 중 하나이고, **PR #15가 넣은 로그가 이걸 구분해준다.**

Render Logs에서 해당 요청 시각의 `ODSAY` 문자열을 찾는다.

- `[routes/search] ODSAY 응답에 result 가 없다 code=... message=...` **줄이 있으면** → ODsay 쪽 문제다. `[ApiKeyAuthFailed]`가 찍혀 있으면 `ODSAY_API_KEY` 값·이름 문제이고 Render 환경변수만 고치면 된다.
- **줄이 없으면** → ODsay는 정상 응답을 준 것이고, 0건은 어댑터의 MVP 필터 때문이다. 필터는 둘이다: 버스 구간이 정확히 1개인 경로만 받고(`busSubPaths.length !== 1 continue`), 하차 정류장이 목적지에서 0.7km를 넘으면 버린다. 수원대→병점역후문은 2026-08-06 실제 캡처로 34/34-1/46/1000번이 나오던 구간이므로, 그렇다면 필터 조건이나 좌표 계산을 봐야 한다.

**주의: 요청을 보낼 때 반드시 stdin으로 본문을 넘긴다.** Windows Git Bash에서 인라인 `-d '...'`로 한글을 넘기면 깨져서 무조건 502가 난다(0절 참고). 이걸 모르면 또 한 시간을 날린다.

```bash
curl -s -X POST https://bus-ta.onrender.com/api/routes/search \
  -H "Content-Type: application/json" -d @- <<'EOF'
{"destination":"병점역후문","latitude":37.213789,"longitude":126.979749}
EOF
```

### 2. ~~PR 병합~~ — **완료 (2026-08-07T15:40Z). 열린 PR 0건.**

PR #16·#17 병합됨, PR #3은 자동 `MERGED`. 통합 브랜치 head `122e86de`. 상세는 0절.

### 3. Task 12 Realtime 세션 smoke 재실행 (**1단계 완료, 2단계 미실행**)

배포된 코드가 유나 구조로 바뀌었으므로 Task 12의 기존 증거는 무효다.

**1단계 — 무인증 거부: 재검증 완료 (2026-08-08 13:51 UTC, 배포본 `122e86de` 대상)**

| 요청 | 결과 |
| --- | --- |
| 헤더 없이 `POST /api/realtime/session` | `401` `{"errorCode":"UNAUTHORIZED"}` |
| 틀린 `x-realtime-shared-secret`로 호출 | `401` `{"errorCode":"UNAUTHORIZED"}` |

「공통 API 및 Function Calling 명세서」 6.1의 오류 계약(`401 UNAUTHORIZED`)과 일치한다. Task 15에서 폐기한 `SERVER_CONFIG_ERROR`나 `500`이 새어 나오지 않는 것도 확인됐다.

**이 결과가 증명하지 못하는 것(중요)**: `apps/server/src/routes/realtime.ts:14`는 **서버에 `REALTIME_SHARED_SECRET`이 없을 때와 요청 값이 틀렸을 때를 의도적으로 똑같이 401로 처리한다**(설정 상태를 응답으로 구분할 수 없게 하려는 설계). 따라서 위 401 두 건은 **Render에 시크릿이 설정돼 있다는 증거가 아니다.** 그 확인은 2단계에서만 가능하다.

**2단계 — 보호 요청 `200` 확인: 미실행.** 올바른 `REALTIME_SHARED_SECRET`이 필요하고, 성공 시 실제 OpenAI client secret이 발급된다(`gpt-realtime-mini`, TTL 600초). 시크릿을 에이전트 대화에 노출하지 않기 위해 **사용자가 직접 실행하고 결과만 공유하는 방식을 권장**한다. 확인 항목은 HTTP `200`, 모델 `gpt-realtime-mini`, `expiresAt` 미래. **발급된 `clientSecret` 값은 출력·기록 금지.**

부수 관측: Free 인스턴스 cold start가 이번에 약 **45초**였다(13:50:43 요청 → 13:51:28 응답). 장애로 오해하지 말 것.

### 4. 실제 외부 API E2E

1번이 풀려야 의미가 있다. 검증할 것:

- `POST /api/routes/search`에 실제 목적지를 넣어 Kakao geocoding → ODsay 경로 후보가 나오는지, **`subPath` 하나가 버스 여러 대를 공유할 때 후보가 실제로 여러 개 나오는지(PR #14 검증)**
- 반환된 후보를 그대로 `POST /api/trips`에 넣어 `predictedArrivalMinutes`가 `null`이 아닌 값으로 오는지
- 외부 API 실패 시 `502 ROUTE_SEARCH_FAILED`로 정규화되는지
- 좌표·API 키가 로그에 남지 않는지 (PR #15가 로그를 늘렸으므로 이번엔 실제로 확인할 것. 설계상 `upstream`/`status`/`message`만 남기지만 눈으로 검증한다)

**주의**: 운영 Supabase에 운행 행을 만든다. 사전 승인 문구를 받고 exact-ID 격리·정리를 함께 계획한다.

### 4-1. 참고 — Render 환경변수 점검 항목 (이미 정상으로 보이지만 1번 결과에 따라 필요)

`KAKAO_REST_API_KEY` / `ODSAY_API_KEY` / `GBIS_SERVICE_KEY` 세 이름으로 값이 들어가 있어야 한다. 이름이 다르면 조용히 실패한다(Kakao 401 → 502, ODsay 빈 결과 → 200 + 빈 배열). `REALTIME_SHARED_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`도 함께 확인한다. `SUPABASE_ANON_KEY`는 **넣지 않는다**(SEC-01 금지). Kakao는 2026-08-08 기준 정상 동작이 확인됐다.

### 4-2. GBIS `occupancy` 구현 (계약 확정, 착수 안 함)

「공통 API 및 Function Calling 명세서」 5.2-A 참고. 선행 미결(라벨 여부, 유나 확인) 해소 후 착수. 영향 범위는 `personal-notes/REMAINING_CHECKLIST.md` B절에 정리돼 있다.

### 5~9. 이전 판과 동일, 순서만 밀림

- `end_trip` 취소 흐름 운영 통합 검증
- 동시 `requestId` 중복 처리 통합 검증
- 종료 상태 보호 4종 분기 통합 검증
- `GET /api/beacons` 통합 검증 (승인 없이 가능한 유일한 gate)
- 노션 문서 정정: 단계 15-1·§19의 통합·배포 브랜치 서술(`yemo-develop`→`claude`), `restrict_future_data_api_access` pending 오기, `search_routes` mock 서술

### 10. 정리·후속

- **ODsay 에 대역(CIDR) 등록 가능 여부 문의 — 미발송 시 유효.** `74.220.52.0/24`, `74.220.60.0/24` 를 등록할 수 있으면 Render outbound IP 변동 위험이 근본적으로 사라진다. 0.4절 참고.
- `.worktrees/outbound-ip`는 PR #18 병합 완료로 제거 가능하지만, **node_modules 가 설치돼 있고 base 가 가장 최신이라 서버 테스트용으로 남겨두는 편이 유용하다.**

- `.worktrees/chaerin-frontend-merge`는 PR #17 병합 완료로 **제거 가능**하다.
- `.worktrees/route-search-observability`는 PR #16 병합 완료로 제거 가능하지만, **`node_modules`가 설치돼 있어 서버 테스트를 바로 돌릴 수 있으므로 남겨두는 편이 유용하다**(이번 세션의 104/104 실행도 여기서 했다).
- `.worktrees/merge-hyorin`, `.worktrees/route-lane-candidates` worktree는 각각 PR #13·#14 병합 완료로 **제거 가능**
- `yemo/note-gbis-occupancy-checklist` 브랜치(메인 checkout, 미커밋) — `REMAINING_CHECKLIST.md` 편집 2건을 커밋·push할지 결정
- `apps/server/package.json`의 `main` 필드와 `tsconfig.json`의 `rootDir` 불일치 — 별도 이슈, 양쪽 부모 모두 동일해 이번 병합들이 만든 문제 아님
- `mock-route-search.adapter.ts`는 라우트에서 쓰이지 않는다. 유지할지 제거할지 결정 필요
- fetch refspec 복구 (1.1절)
- 공유 상수 SSOT 소실(Task 15 후속): `packages/shared/src/constants/realtime.ts` 삭제로 헤더명·모델명이 서버·모바일에 중복 하드코딩됨. 후속 과제.
- 이 handoff와 `.agent-loop/`, `lessons.md`를 커밋할지 결정 — 현재 전부 미커밋

---

## 6-A. PR #3 프론트엔드 병합 충돌 — **완전히 종결됨 (PR #17 병합 → PR #3 자동 `MERGED`, 2026-08-07T15:40Z)**

> **상태: 전부 종결됐다. 남은 조치 없음.** PR #17이 병합됐고 PR #3은 GitHub가 자동으로 `MERGED` 처리했다(따로 닫을 필요가 없었다). 결과는 3절 Task 16·18에 있다.
> 아래 진단 내용은 왜 그렇게 해소했는지 근거로 남겨둔다 — 나중에 병합 결과를 의심할 일이 생기면 이 절이 판단 기준이다.

### 6-A.1 무슨 일이 있었나

PR #3(https://github.com/yemoyang9-a11y/bus-ta/pull/3, 임채린)은 2026-07-30에 `client.ts` 오류 처리 개선과 화면 4개(ConfirmScreen, RouteListScreen, RidingScreen, AlightScreen) 실제 백엔드 연동을 담아 열렸다. 그 시점 한 번 `claude`를 병합해 넣었지만(커밋 `276e38b`, "merge: claude 브랜치 최신 변경사항 병합"), 이후 갱신이 없었다.

그사이 `claude/nice-archimedes-iv7iu0`는 38커밋 앞서갔다 — Realtime PR #4, SEC-01 보안, 효린 어댑터 통합 PR #13, 노선 후보 다중화 PR #14가 전부 그 안에 있다. `gh pr view 3`으로 확인한 현재 상태: `mergeStateStatus: DIRTY`, `mergeable: CONFLICTING`.

**Realtime 충돌(6-A였던 그 문제)과 근본적으로 다르다.** 그건 두 사람이 같은 기능을 각자 만들어서 계약이 정반대였던 진짜 모순이었다. 이건 그냥 한쪽이 오래 멈춰 있어서 벌어진 정체다. 두 구현이 서로 다른 답을 주장하는 지점이 없다.

### 6-A.2 충돌 파일 4개 (`git merge-tree`로 확인, 2026-08-06)

```text
apps/mobile/app.json          (content)
apps/mobile/package.json      (content)
apps/mobile/src/api/client.ts (content)
pnpm-lock.yaml                 (content)
```

### 6-A.3 파일별 실제 내용과 위험도

**`app.json` — 위험 없음, 순수 추가.** `claude`는 마이크 권한·WebRTC 플러그인(Realtime용), PR #3은 블루투스 권한·BLE 플러그인·EAS `projectId`(스마트지팡이용)를 각자 다른 자리에 추가했을 뿐이다. `app.config.ts`(Realtime이 추가)가 `app.json`의 `extra`를 그대로 펼쳐 쓰는 구조라 EAS `projectId`와도 공존한다(직접 확인). 양쪽 다 유지하면 끝이다.

**`package.json` — 결정 1건 + 치명적 함정 1건.**

함정: `expo-constants`가 `claude`에만 있다(PR #3은 갈라져 나온 시점에 아직 없었을 뿐). `apps/mobile/src/realtime/runtime-config.ts:1`이 이미 이걸 import한다(직접 grep 확인). **빠지면 빌드가 깨진다.**

결정: `@config-plugins/react-native-webrtc`(`claude` `13.0.0` 고정 vs PR #3 `^15.0.1`), `react-native-webrtc`(`claude` `124.0.6` 고정 vs PR #3 `^124.0.8`). `claude` 쪽은 정확 버전 고정, PR #3은 범위 지정이라 설치 시점에 우연히 새 버전이 잡혔을 가능성이 있다 — 의도적 업그레이드인지 미확인. **사용자 결정 필요.**

**`client.ts` — 가장 위험한 파일.** `ApiError` 클래스와 `request()` 오류 처리를 양쪽이 각자 독립적으로 구현했는데 로직은 사실상 동일하다(주석 차이뿐). 진짜 위험은 파일 끝의 `apiClient.realtime.createSession` 블록이 **`claude`에만 있고 PR #3엔 아예 없다**는 것이다. `apps/mobile/src/realtime/session.ts:21`이 이걸 직접 호출한다(직접 grep 확인). **병합을 잘못하면 Realtime 세션 오픈 기능 전체가 조용히 사라진다.**

**`pnpm-lock.yaml`** — 위 결정이 끝난 뒤 재생성한다. 손으로 풀지 않는다.

### 6-A.4 해소 방향 (**실행 완료**)

`ApiError`/`request()`는 `claude` 쪽 기준. `apiClient.realtime` 블록은 무조건 유지. `app.json`·나머지 dependency는 양쪽 다 포함(union). WebRTC는 사용자 결정에 따라 `claude` 고정 유지.

**전부 그대로 실행됐고 검증됐다(3절 Task 16).** 6-A.2가 예측한 충돌 파일 4개는 실제와 정확히 일치했고, 6-A.3이 경고한 두 함정(`expo-constants` 누락, `apiClient.realtime` 소실)은 Implementer·Reviewer 양쪽 실측으로 발생하지 않았음을 확인했다.

### 6-A.5 작업 방식 (**실행 완료**)

새 worktree `.worktrees/chaerin-frontend-merge`, 브랜치 `yemo/resolve-chaerin-frontend-conflict`에서 서브에이전트 2개(Implementer, Reviewer) 구성으로 진행했다. Implementer가 구현+테스트 전체를 실행하고 Reviewer가 같은 명령을 독립 재실행해 교차검증하는 Task 15와 동일한 방식이다. 재시도 0회로 통과했다.

**이번에 드러난 이 방식의 한계**: Reviewer의 검증이 grep·typecheck·테스트 개수 중심이라 **주석 한 줄이 사라진 것을 잡지 못했다**(3절 Task 16 참고). Director가 `git diff <base> -- <파일>`을 직접 읽어서 발견했다. 다음 루프에서도 Director는 라인 단위 diff를 직접 본다.

### 6-A.6 반영 경로 — **해소됨 (2026-08-08). 선택지 1번(새 PR)으로 확정, 실행 완료**

사용자가 "브랜치 push하고 새 PR 열어"로 선택지 1번을 지시했다. 실행 결과는 3절 Task 18에 있다.

- `client.ts` 주석 1줄은 **복원했다**(`70fdae4`). 기존 커밋 amend 금지 규칙을 지켜 별도 커밋으로 올렸다.
- 통합 브랜치 최신분 `2578183`까지 병합(`02269d1`). 충돌 0건.
- push 완료, **PR #17** 생성. `MERGEABLE`/`CLEAN`.
- **남은 것은 사용자의 병합과 PR #3 닫기뿐이다.** 병합이 끝나면 `.worktrees/chaerin-frontend-merge` worktree를 제거해도 된다.

---

## 7. 역할 루프 규칙

```text
Director 분석 → Implementer → Tester → Reviewer → Director 최종 검수
```

- 각 역할은 순차 호출한다. Tester `PASS` 전에는 Reviewer를 호출하지 않는다.
- Codex 환경: 각 역할이 `gpt-5.6-luna / xhigh`인지 먼저 확인하고 `max`면 시작하지 않고 보고한다.
- Claude Code 환경: Director는 Opus 5, 서브에이전트는 Sonnet 5. **호출 단위 reasoning effort 지정은 불가능하다.** 실제 모델과 관측 가능한 설정만 사실대로 보고하고, 보장 불가한 값을 보장했다고 쓰지 않는다.
- `.codex/agents/*.toml`은 Claude Code에서 로드되지 않는다. 해당 규칙을 프롬프트로 이식한 범용 서브에이전트가 역할을 수행하며, 독립 Codex 역할 환경과 동일한 증거로 취급하지 않는다.
- Reviewer가 `REJECT`면 재시도 횟수를 올리고 Implementer부터 반복한다. 최대 3회.
- Director는 애플리케이션 코드를 직접 수정하지 않는다.
- **Reviewer의 판정을 그대로 받아들이지 않는다.** Task 13에서 Reviewer가 공통 오보고를 잡아냈고, Task 15에서도 Reviewer의 REJECT 근거를 Director가 직접 재확인했다. **Task 16에서는 반대 방향의 사례가 나왔다 — Reviewer가 `APPROVE`하며 "문제 없음"이라 했지만 실제로는 주석 1줄이 사라져 있었고, Director가 `git diff`를 직접 읽어서 발견했다.** grep·typecheck·테스트 개수 기반 검증은 "존재해야 할 것이 있는가"는 잡아도 "없어진 것이 있는가"는 잡지 못한다. 파괴적 작업 직전의 수치와 병합 결과의 라인 단위 diff는 Director가 직접 본다.
- **서브에이전트를 최소화한다(2026-08-06 사용자 지시).** 기본 3역할(Implementer/Tester/Reviewer) 대신, Implementer가 구현+테스트 전체 실행을 겸하고 Reviewer가 독립 재실행으로 교차검증하는 2-에이전트 구성을 Task 15·16에서 썼다. 불필요한 서브에이전트를 늘리지 않는다.
- 통합 브랜치·개발 브랜치에 직접 push 금지. 루프 전용 feature 브랜치에서 작업하고 PR로 올린다.
- PR 승인·병합, force push, rebase로 공유 이력 변경은 금지다.

---

## 8. Claude Code 환경 특이사항

- **⚠️ curl로 한글이 든 요청 본문을 보낼 때는 반드시 stdin으로 넘긴다(2026-08-07 실제 사고, 한 시간 손실).** Windows Git Bash에서 **명령줄 인자**(`-d '{"destination":"병점역후문",...}'`)로 넘긴 한글은 CP949로 변환돼 깨진다. heredoc(`-d @-` + `<<'EOF'`)이나 UTF-8 파일(`-d @body.json`)은 원본 바이트를 그대로 전달한다. 깨진 목적지는 Kakao에서 0건이 나와 `502 ROUTE_SEARCH_FAILED`가 되므로 **서버 장애로 오인하기 쉽다.** 로그에 `upstream=UNKNOWN status=unknown message=목적지를 찾을 수 없습니다: <깨진 문자열>`이 보이면 이 함정이다(`upstream=UNKNOWN`은 Kakao 호출 자체는 성공했다는 뜻). 자세한 내용은 `lessons.md`와 `docs/TROUBLESHOOTING.md`(PR #16).
- **"같은 요청인데 결과가 달라졌다"고 판단하기 전에 내 명령 형태가 정말 같았는지 대조한다.** 위 사고에서 "장애 시작 시각"은 내가 프로브 명령 형태를 바꾼 시각과 초 단위로 일치했는데, 한 시간을 서버 쪽에서 찾았다. 관측 대상이 변했다고 결론 내리기 전에 관측 도구가 변하지 않았는지 먼저 본다.
- `date`의 `TZ=Asia/Seoul` 지정이 이 셸에서는 먹지 않는다. KST가 필요하면 `date -u`에 9시간을 더해 환산한다.
- auto mode 권한 분류기가 Supabase `DELETE`를 자동 거부한다. `acceptEdits`나 `default` 모드로 바꾸면 자동 거부 대신 사용자 승인 프롬프트가 뜬다(Task 13 실측).
- `bypassPermissions`나 `mcp__supabase__execute_sql` 영구 허용 규칙은 권하지 않는다.
- 다른 PC, 다른 checkout, 클라우드 세션은 미커밋 로컬 파일을 자동으로 볼 수 없다.
- **`git stash -u` 사용 시 주의(2026-08-06 실제 사고).** untracked 디렉터리 삭제가 권한 오류로 일부 실패해도 stash 자체는 "성공"처럼 보이는 메시지를 낸다. tracked 파일 하나만 확인하고 "중복이니 drop"으로 판단하면 안 된다 — 같은 stash 안의 다른 untracked 파일이 이미 삭제됐을 수 있다. drop 전 `git stash show -p --include-untracked`로 전체를 확인한다. 사고가 나도 방금 drop한 stash라면 `git cat-file -p <드롭된 stash 해시>`로 부모 커밋(특히 3번째 parent = untracked 파일 트리)을 찾아 `git checkout <sha> -- <path>`로 복구할 수 있다(gc 전이라면).

---

## 9. 금지·보존 사항

- 실제 환경변수 값, API 키, 공유 시크릿, Realtime `clientSecret`을 출력·복사·저장하지 않는다.
- `SUPABASE_ANON_KEY`를 서버 fallback으로 사용하지 않는다. `render.yaml`·`.env.example`에도 넣지 않는다.
- 새 코드 작업은 `claude/nice-archimedes-iv7iu0`(항상 최신 원격 SHA로 재확인) 기준 전용 브랜치·worktree에서 시작한다.
- WebRTC/Function Dispatcher/BLE 앱 책임을 백엔드에 임의 구현하지 않는다.
- 명세 §20의 미확정 항목(BLE 감지 결과 저장 API, Realtime 서버 Push, 운행 복원 정책, `FAIL` 재시도, `ERROR` 전환 조건, 후보 위변조 방지 저장 위치, 사용자·세션 식별 모델, 강한 앱 인증)을 임의로 구현하거나 완료로 표시하지 않는다.
- 실행하지 않은 테스트를 통과했다고 보고하지 않는다.
- 커밋, push, PR, merge, deploy를 서로 독립된 사실로 기록한다.
- 행 수 검증에 `list_tables` 추정치를 쓰지 않는다. `select count(*)`를 쓴다.
- remote-tracking ref를 브랜치 관계 판단 근거로 쓰지 않는다. `ls-remote`나 명시적 fetch로 확인한다.
- **`git stash -u` 후 drop하기 전에 반드시 `--include-untracked`로 전체 내용을 확인한다.**
