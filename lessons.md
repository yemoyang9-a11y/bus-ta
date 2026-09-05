# Lessons

작업 중 발견하고 **검증까지 끝난** 오류와 해결책을 누적한다. 추측만 하고 확인하지 못한 원인은 적지 않는다.

---

## 2026-08-14 — Supabase MCP `apply_migration`은 **파일명의 버전을 쓰지 않는다.** 적용 후 저장소 파일명을 맞춰야 한다

**증상.** 저장소에 `20260814023000_align_demo_beacon_to_real_esp32.sql`을 만들어 두고
MCP `apply_migration`으로 적용했더니, `list_migrations`에 기록된 버전은
**`20260814063714`**(적용 시각)였다. 파일명과 원격 이력이 어긋난다.

**원인.** `apply_migration`은 인자로 `name`과 `query`만 받는다. **버전은 서버가 적용 시각으로
생성한다.** 파일명을 참조하지 않으므로, 미리 정한 타임스탬프는 무시된다.

**이번이 두 번째다.** `f25e3b6`("chore: align Supabase migration version")도 같은 원인이었다 —
`20260804142432_restrict_future_data_api_access.sql`을 `20260805045657_...`로 rename하고
그 이름을 참조하던 문서 2곳과 테스트 3곳까지 함께 고쳐야 했다.

**해결 절차.** 적용 직후 `list_migrations`로 실제 기록된 버전을 확인하고, 저장소 파일을
`git mv`로 그 버전에 맞춘다. 파일명을 문자열로 참조하는 곳(주석·문서·테스트)을 함께 검색해 고친다.

```bash
git grep -n "<이전_버전>_"
```

**대안**: 파일명을 먼저 확정하고 싶으면 MCP 대신 `supabase db push`로 적용한다.
그 경로는 파일명의 버전을 그대로 이력에 넣는다. MCP를 쓸 거면 **파일명은 적용 후에 정한다**고
생각하는 편이 맞다.

---

## 2026-08-14 — 공개 API의 **값 계약**이 바뀔 때도 `docs/API_SPEC.md`를 고쳐야 한다. 구조가 안 바뀌면 넘어가기 쉽다

**증상.** 시연 비콘 ID를 `MOCK_BUS_1551_001` → `BUS_1551_001`(`isMock` false)로 정렬하면서
`REQUIREMENTS.md`·`MIDTERM_SCOPE.md`는 고쳤는데 `API_SPEC.md`를 건드리지 않았다.
PR #25의 Codex 리뷰가 P2로 잡았고, 지적이 맞았다.

**원인.** AGENTS.md 규칙을 "요청·응답 **구조**가 바뀌면 명세를 고친다"로 좁게 읽었다.
필드 이름도 타입도 그대로였으니 해당 없다고 판단한 것이다. 그러나 `targetBeaconId`가 어떤
형식을 갖는지, `isMock`이 무엇을 뜻하는지는 **API 소비자가 명세에서 발견해야 하는 계약**이고,
그 파일에는 애초에 비콘 응답 서술이 하나도 없어 신설이 필요한 상태였다.

**이번이 두 번째다.** 2026-08-11 PR #20에서 `predictedArrivalMinutes` → `arrivals` 배열을
바꿨을 때도 같은 이유로 `API_SPEC.md`를 빠뜨렸고, 같은 Codex 리뷰가 잡았다(handoff 0.4-B).
두 번 다 "기존 서술 중 고칠 게 있나"로 읽어서 **서술 자체가 없는 경우**를 놓쳤다.

**검증된 판정 기준.** 구조 변경 여부로 묻지 말고 이렇게 묻는다.

> 이 변경 뒤에 클라이언트 개발자가 `docs/API_SPEC.md`만 읽고 올바른 값을 만들 수 있나?

아니라면 고친다. 값 형식·sentinel 의미·열거값·상태 코드가 전부 여기 해당한다.
그 파일에 해당 엔드포인트 서술이 없으면 **없다는 사실이 곧 신설 사유다.**

참고: `docs/API_SPEC.md` 「비콘 조회」절(커밋 `d45c964`), 「운행 생성 도착 정보」절(커밋 `52bdbe1`).

---

## 2026-08-12 — 미커밋 문서를 동기화할 때, 로컬 사본이 저장소보다 **오래된** 파일이 섞여 있다

**증상(사전 발견 — 커밋 전에 잡았다)**
오래된 브랜치의 worktree(`yemo/be16-api-state-test-coverage`, base `50834d4`)에 쌓인 미커밋 문서를
통합 브랜치(`e7b4408`) 기준 브랜치로 옮겨 PR을 만들려 했다. 파일 4개 중 3개는 로컬이 최신이었지만
`CLAUDE.md` **하나만 방향이 반대**였다. 그대로 복사했으면 「프로젝트 주요 흐름」의
BLE·비콘 5줄(`targetBeaconId` 조회, 스마트지팡이 ESP32, RSSI 판단, 버스측 ESP32 LED·부저)이 조용히 사라졌다.

**원인**
"미커밋 = 로컬이 더 최신"이 아니다. worktree의 base가 오래됐으면 **그 사이 다른 PR이 저장소에서 고친
tracked 파일**은 로컬 사본이 오히려 과거다. 미커밋 편집분과 낡은 base가 같은 파일에 겹쳐 있어 겉으로 구분되지 않는다.

**검증된 해결책**
동기화 대상 파일을 통째로 복사하지 말고 **파일별로 방향을 먼저 확인한다.**

```bash
# tracked 파일: 목표 base와 직접 비교해 어느 쪽이 최신인지 본다
git diff <target-base> -- <path>          # '-' 줄 = base에만 있는 내용 = 잃게 될 내용

# untracked 파일: 위 diff는 b쪽이 비어 "전량 삭제"처럼 보인다. 착각하지 말 것.
git show <target-base>:<path> > /tmp/repo && comm -23 <(sort -u /tmp/repo) <(sort -u <path>)
# 출력이 비면 저장소 내용이 전부 로컬에 있다(= 안전한 superset)
```

방향이 반대인 파일은 **저장소 최신본 위에서 필요한 편집만 다시 적용한다**(이번엔 `.agent-loop/` 문장 1줄).
`git diff --cached --stat`의 삭제 라인 수가 0이 아니면 삭제분을 눈으로 읽는다 —
2026-08-07 항목의 "grep·typecheck으로는 사라진 것을 못 잡는다"와 같은 실패 유형이다.

**관련**: PR #21(`yemo/sync-handoff-docs-0812`), handoff 1.2절.

---

## 2026-08-11 — GBIS `remainSeatCnt=0`은 만석이 아니라 "미보고"다. 원본 값을 그대로 흘리면 여유 버스를 만석으로 안내한다

**증상(사전 발견 — 실제 사고가 나기 전에 잡았다)**
`crowded`·`remainSeatCnt`를 응답 계약에 그대로 실으면, 일반시내버스에서 "잔여좌석 0석"이 대량으로 나온다.
실제 캡처(`apps/server/src/adapters/routes/__fixtures__/gbis-bus-arrival-list-station-233000575.json`, 2026-08-06 stationId=233000575)에서 일반시내버스 9건이 **전부** `crowded=1`(여유)이면서 동시에 `remainSeatCnt=0`이었다.

**원인**
`remainSeatCnt`는 좌석 수를 보고하는 차종(직행좌석 등)에서만 유효하다. 그 외 차종은 미사용 기본값 `0` 또는 `-1`을 넣는다.
여유(`crowded=1`)인 버스가 0석일 수 없으므로 이 `0`은 "0석"이 아니라 "정보 없음"이다.
`crowded` 쪽도 같은 구조라서 `""`와 `0`이 모두 정보 없음이고, 유효 범위는 `1~4`다.
**우리 계약은 같은 숫자 `0`에 정반대 의미(만석)를 부여하고 있었다** — 원본 도메인과 계약 도메인에서 뜻이 뒤집히는 값이었다.

**검증된 해결책**
adapter 경계에서 원본 값을 계약값으로 변환한다. 판정 규칙은 다음과 같다.

| 원본 | 값 | 해석 |
| --- | --- | --- |
| `crowded1/2` | `""`, `0` | 정보 없음 |
| `crowded1/2` | `1~4` | `congestionLevel` 유효 |
| `remainSeatCnt1/2` | `""`, `-1`, **`0`** | 정보 없음 |
| `predictTime1/2` | `""` | 해당 순번 차량 없음 → 배열에 넣지 않음 |

둘 다 유효하면 더 구체적인 잔여좌석을 우선하고(`REMAINING_SEATS`), 둘 다 없으면 `UNAVAILABLE`이다.
`apps/server/src/adapters/routes/hyorin-route-search.adapter.ts`의 `readRemainingSeats`(유효값 `>= 1`)와
"시내버스의 remainSeatCnt=0 은 잔여좌석 0석이 아니라 정보 없음으로 읽는다" 회귀 테스트로 고정했다. 서버 테스트 122/122 통과.

**교훈 일반화**
공공 API의 숫자 `0`은 "값이 0"과 "값 없음"을 구분하지 않는 경우가 많다.
**같은 응답 안의 다른 필드(여기서는 `crowded=1`)와 모순되면 그 `0`은 데이터가 아니라 기본값이다** — 값 분포만 세지 말고 필드 조합을 함께 봐야 갈린다.
원본을 그대로 공개 계약에 싣지 말고 adapter에서 해석을 끝내고, 그 해석을 실제 캡처 fixture 기반 테스트로 못박는다.

---

**⚠️ 위 규칙은 같은 날 정정됐다 — 실측 추정만으로 멈추지 말고 공식 문서를 찾아라 (2026-08-11 후속)**

위 분석은 **결론이 우연히 맞았지만 규칙이 틀렸다.** GBIS 공식 매뉴얼(gbis.go.kr 버스 도착정보 항목조회)을 확인하니 실제 구조는 이랬다.

- **`routeTypeCd`(노선유형)가 애초에 어느 필드가 유효한지 결정한다.** "한 버스가 둘 다 줄 수 있고 우선순위로 고른다"가 아니다.
- `crowded` 유효 노선유형: `13`·`15`·`23` / `remainSeatCnt` 유효 노선유형: `11`·`12`·`14`·`16`·`17`·`21`·`22`
- **`remainSeatCnt`의 공식 "정보없음" sentinel은 `-1` 뿐이다. `0`은 유효값(만석)이다.**

즉 시내버스(13)의 `0`을 정보없음으로 본 것은 결과적으로 맞았지만(그 노선유형은 애초에 이 필드 대상이 아니므로), **"값이 0이면 무조건 정보없음"이라는 규칙은 좌석형 노선이 진짜 만석이 되어 `0`을 보낼 때 그것을 잘못 접는 결함이었다.** 실측 데이터에 그 사례가 없어서 테스트로도 안 걸렸다.

**진짜 교훈**: 실측 캡처로 패턴을 찾았어도 그건 **가설**이다. 관측되지 않은 케이스(여기서는 "좌석형이 만석일 때")에서 그 가설이 어떻게 깨지는지는 데이터가 알려주지 않는다. **공식 문서에서 필드의 정의와 sentinel 규약을 확인하기 전까지 값 기반 추정을 최종 규칙으로 굳히지 마라.** 확인 비용은 검색 몇 분이었고, 안 했으면 좌석형 만석 안내가 조용히 사라지는 버그로 남았다.

확정된 매핑 규칙은 노션 「공통 API 및 Function Calling 명세서」 5.2-A에 있다(공식 문서 근거로 재확정). 구현은 `hyorin-route-search.adapter.ts`의 `toOccupancy`가 `routeTypeCd`로 분기하며, 합성 테스트 5개로 고정했다.

**남은 미확인**: 좌석형 노선이 실제 만석일 때 `remainSeatCnt=0`을 정말 보내는지는 실물로 관측된 적이 없다(fixture에 사례 없음). 혼잡 시간대 재캡처가 필요하다.

---

## 2026-08-11 — worktree 는 OneDrive 밖 짧은 경로에 만들면 기존 함정을 통째로 피한다

**증상(기존 기록)**
`.worktrees/` 아래(OneDrive 동기화 폴더)에 만든 worktree 는 제거할 때 OneDrive "파일 온디맨드" 자리표시자 때문에 `Permission denied` 가 나고, `node_modules` 가 있으면 pnpm 중첩 경로가 MAX_PATH 를 넘겨 `Filename too long` 이 난다. 게다가 git 이 `.git` 파일을 먼저 지운 뒤 실패해 "반쯤 제거된 상태"가 남는다(2026-08-10 항목 참고).

**검증된 해결책**
worktree 를 OneDrive 밖 짧은 경로에 만든다. `C:/Users/yemoy/bta-gbis` 로 생성한 결과 `pnpm install --frozen-lockfile` 이 1분 2초에 정상 완료됐고(778 패키지), 서버 테스트 108/108 이 그대로 통과했다. 자리표시자·MAX_PATH 문제가 발생하지 않았다.

**적용 범위**
새 작업용 worktree 는 `.worktrees/` 대신 OneDrive 밖 짧은 경로를 기본으로 쓴다. 다만 이미 `.worktrees/` 아래 있는 기존 worktree 를 옮기라는 뜻은 아니다 — 미커밋 파일이 있는 것들은 그대로 둔다.

---

## 2026-08-11 — Node v24(Windows)에서 fetch 호출 뒤 `process.exit()`을 쓰면 libuv assertion으로 죽는다

**증상**
`scripts/check-api.mjs`(Render cold start 워밍업 확인용, 내장 `fetch`로 `/api/health` 폴링)가 healthy 응답을 정확히 받고 정상 로그까지 찍은 뒤 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`로 죽었다. `exit=127`. `fetch` 성공/실패, `AbortSignal.timeout()` 사용 여부와 무관하게 재현됐다 — 첫 시도(0.0초, 즉시 성공)에서도 동일하게 발생했다.

**원인**
`fetch()`(Node 내장 undici)가 남긴 내부 libuv 비동기 핸들이 아직 닫히는 중(`UV_HANDLE_CLOSING`)일 때 `process.exit()`으로 강제 종료하면 Windows 쪽 libuv 코드가 assertion으로 죽는다. Node v24.15.0, Windows 11에서 실측. `AbortSignal.timeout()`을 수동 `AbortController`+`clearTimeout`으로 바꿔도 재현됐으므로 원인은 그쪽이 아니라 `fetch` 자체 + `process.exit()` 조합이다.

**검증된 해결책**
`process.exit(code)` 대신 `process.exitCode = code`를 쓰고 자연 종료를 기다린다. 이벤트 루프가 스스로 비워지면서 정상적으로 exit code가 반영되고 assertion이 재발하지 않았다(같은 스크립트로 3회 재현·재확인).

**적용 범위**
Node 내장 `fetch`를 쓰는 CLI 스크립트에서 마지막에 `process.exit()`으로 종료 코드를 강제하는 패턴을 이 저장소에서 반복하지 않는다. `scripts/check-api.mjs` 참고.

---

## 2026-08-09 — ODsay `ApiKeyAuthFailed`의 정체는 등록 IP 불일치였다. 배포처 outbound IP를 로그로 드러내 해결했다

**증상**
운영 `POST /api/routes/search`가 목적지·지역·거리와 무관하게 100% `200 + routes: []`를 반환했다. 프로브 7건 전부 0건이고 502는 하나도 없었다. Render 로그에는 `[routes/search] ODSAY 응답에 result 가 없다 code=500 message=[ApiKeyAuthFailed] ApiKey authentication failed.`가 남아 있었다.

**원인**
ODsay는 애플리케이션에 **등록된 IP에서 온 호출만** 허용한다. 콘솔에 등록돼 있던 것은 국내 가정용 회선 두 개뿐이었다(인천 SK Broadband, 수원 KT — 팀원 로컬). 실제 주소는 개인 회선이라 공개 저장소인 이 문서에 적지 않는다. 운영은 Render 싱가포르에서 나가므로 애초에 등록된 적이 없었다. 팀원이 로컬에서 같은 키로 실제 응답을 캡처하는 데 성공했던 것이 이 구조를 그대로 보여준다.

**진짜 막힌 지점은 "어떤 IP를 등록해야 하는지 알 수 없다"였다**

- Render 대시보드(`Connect` → `Outbound`)는 개별 주소가 아니라 대역만 준다: `74.220.52.0/24`, `74.220.60.0/24`(512개). ODsay 입력창은 단일 IP만 받아 슬래시 표기를 "공인 IP가 아니다"로 거부한다.
- 등록 IP 목록을 비워 전체 허용으로 만드는 것도 불가능하다. **ODsay는 최소 1개를 강제한다.**
- `bus-ta.onrender.com`을 DNS 조회해 나오는 `216.24.57.x`는 **인바운드 엣지 IP**다. 등록해도 소용없다. 등록해야 하는 건 outbound다.
- `mcp__supabase__get_logs(service: api)`로 서버의 접속 IP를 알아내려 했으나 **`event_message`에 클라이언트 IP 필드 자체가 없다.** 같은 시도를 반복하지 말 것.

**검증된 해결책**
서버 부팅 시 공인 IP를 1회 조회해 로그로 남기게 했다(PR #18, `apps/server/src/diagnostics/outbound-ip.ts`). 배포 후 Render Logs의 `[startup] outbound ip=...` 값을 ODsay 콘솔에 등록하자 **프로브 6건이 전부 후보를 반환했다**(2026-08-09 08:14 UTC). 코드 쪽 어댑터·필터는 처음부터 정상이었고 고칠 것이 없었다.

**재발 위험 — 반드시 알고 있을 것**
Render 무료 플랜의 outbound IP는 고정이 보장되지 않는다. 대역이 두 개나 공지된다는 것 자체가 그 안에서 바뀔 수 있다는 뜻이고, 무료 인스턴스는 15분 무활동으로 잠들었다 깨며 재스케줄된다. **IP가 바뀌면 노선 검색이 다시 통째로 죽는데, 증상은 502가 아니라 "그냥 결과가 없다"라서 현장에서 알아채기 어렵다.** cold start마다 `[startup] outbound ip=` 줄이 새로 찍히므로 시연 전에는 이 값이 등록된 IP와 같은지 확인한다.

**부산물**
`74.220.x.x` 대역의 역방향 호스트명이 `ip-74-220-52-1.singapore-egress.render.com`이다. Render의 리전별 egress 대역은 이렇게 호스트명으로 확인할 수 있다. 반면 `origin.onrender.com` 쪽에 붙는 `gcp-us-west1` 같은 이름은 엣지 라우팅이라 실행 리전과 무관하다.

---

## 2026-08-08 — Windows Git Bash에서 curl 인자에 한글을 넣으면 깨진다. 한 시간짜리 오진의 원인이었다

**증상**
운영 `POST /api/routes/search`가 22:27 KST부터 모든 목적지에 대해 `502 ROUTE_SEARCH_FAILED`를 반환하기 시작했다. 22:25·22:26에는 같은 목적지가 정상 통과했다. 재배포도, 환경변수 변경도 없었고(Render Events로 확인), `dbStatus`는 계속 `UP`이었다. 68분간 지속됐고 인스턴스 cold start를 넘겨도 그대로였다.

**내가 내린 (틀린) 결론**
"서버는 그대로인데 같은 요청이 시간에 따라 달라졌다 → 변한 쪽은 Kakao다"로 판단하고, 쿼터 초과·키 폐기·허용 IP 제한을 후보로 좁혔다. 자정 쿼터 리셋 관측까지 예약했다.

**실제 원인**
요청은 같지 않았다. **내 curl 명령의 형태가 달랐다.**

```bash
# 22:25, 22:26 — 정상 동작
curl -X POST "$URL" -H "$H" -d @- <<'EOF'
{"destination":"병점역후문", ...}
EOF

# 22:27 이후 — 전부 502
curl -X POST "$URL" -H "$H" -d '{"destination":"병점역후문", ...}'
```

Windows Git Bash에서 **명령줄 인자**로 넘긴 한글은 프로세스에 전달되는 과정에서 CP949로 변환돼 깨진다. **heredoc/stdin**은 원본 UTF-8 바이트를 그대로 흘려보내므로 멀쩡하다. 서버는 깨진 문자열을 받아 Kakao에 검색했고, Kakao가 `documents: []`를 돌려주자 어댑터가 `목적지를 찾을 수 없습니다`를 던져 502가 됐다. **Kakao 키·쿼터·IP 전부 정상이었다.**

**검증**
같은 초에 두 형태를 나란히 보내 확인했다(2026-08-08 00:02 KST).

```
heredoc(stdin)   → {"success":true,"destination":"병점역후문","routes":[], ...}
인라인 -d '...'  → {"success":false,"errorCode":"ROUTE_SEARCH_FAILED", ...}
```

**어떻게 잡았나**
직전에 머지한 PR #15(외부 API 실패를 로그로 드러내는 수정)의 첫 로그 한 줄이 끝냈다.

```
[routes/search] 외부 API 요청 실패 upstream=UNKNOWN status=unknown message=목적지를 찾을 수 없습니다: <깨진 문자열>
```

`upstream=UNKNOWN`이 "Kakao 호출 자체는 성공했다"를 말해줬고(호출 실패였다면 `upstream=KAKAO status=401` 식으로 찍힌다), 소스에 박힌 한글은 멀쩡한데 **요청 본문에서 온 목적지만 깨져 있다**는 대비가 범인을 지목했다.

**규칙**
- 이 환경에서 non-ASCII가 포함된 요청 본문은 **반드시 stdin으로 넘긴다**(`-d @-` + heredoc). 인라인 `-d '...'`는 쓰지 않는다.
- 파일로 저장해 `-d @body.json`을 쓰는 것도 안전하다(단, 파일을 UTF-8로 쓸 것).

**추론 관점의 교훈 (이쪽이 더 중요하다)**
"같은 요청인데 결과가 달라졌다"를 근거로 서버 쪽 변화를 단정했지만, **내 요청이 정말 같았는지 대조하지 않았다.** 관측 대상이 바뀌었다고 결론 내리기 전에 **관측 도구가 바뀌지 않았는지 먼저 확인한다.** 특히 "이 시각부터 갑자기"라는 패턴이 보이면, 그 시각에 내가 명령·스크립트·도구를 바꾸지 않았는지 자기 이력부터 diff한다. 이번엔 프로브 명령 형태를 바꾼 시각과 "장애 시작 시각"이 초 단위로 일치했는데도 한 시간을 서버 쪽에서 찾았다.

---

## 2026-08-07 — `catch {}`는 운영 장애를 진단 불가능하게 만든다. "로그에 없다"가 "오류가 없었다"는 아니다

**증상**
운영 `POST /api/routes/search`가 `502 ROUTE_SEARCH_FAILED`를 돌려주는데 원인을 알 수 없었다. Render 로그를 해당 시각(13:27~13:32 UTC)과 KST 환산 구간에서 찾고, 최근 7일 `AxiosError`·`status code`로 검색해도 **일치하는 로그가 하나도 없었다.** "로그가 없으니 오류가 안 난 것 아니냐"는 해석까지 나왔다.

**원인**
`apps/server/src/services/route/search-routes.service.ts`가 이렇게 돼 있었다.

```ts
try {
  routes = await dependencies.searchRoutes(parsed.data);
} catch {          // ← 오류 객체를 바인딩조차 하지 않는다
  return { httpStatus: 502, ... };
}
```

AxiosError가 여기서 완전히 소멸한다. 서버 전체 `console.*`은 4곳뿐이고(기동 로그, guide.ts의 OpenAI 실패, demo 2곳) 노선 검색 경로엔 하나도 없다. Express 요청 로거 미들웨어도 없다. **즉 로그가 안 나오는 게 정상이고, 아무리 뒤져도 나올 수 없었다.**

같은 파일 계열의 `hyorin-route-search.adapter.ts`에도 쌍둥이 문제가 있었다. `if (!res.data.result) return []` — ODsay는 키가 틀려도 **HTTP 200 + error 본문**을 주기 때문에(2026-08-07 직접 확인: `{"error":[{"code":"500","message":"[ApiKeyAuthFailed] ApiKey authentication failed."}]}`), 인증 실패가 "조건에 맞는 후보 없음"과 완전히 같은 빈 배열로 나온다.

**검증된 해결책**
실패 지점을 로그로 드러낸다. 공개 계약(502 / 200+빈 배열)은 바꾸지 않았다.

- Kakao/ODsay 호출을 `requestUpstream(upstream, url, config)`로 감싸 실패 시 `upstream`·HTTP `status`를 담은 오류를 던진다.
- 서비스는 502 전에 `[routes/search] 외부 API 요청 실패 upstream=... status=... message=...`를 남긴다.
- ODsay 응답에 `result`가 없으면 error 코드·메시지를 남긴다.

TDD로 실패 테스트 6개를 먼저 작성해 전부 실패하는 것을 확인한 뒤 구현했다. 서버 테스트 104/104 pass(기존 98 + 신규 6), typecheck·build 통과. 브랜치 `yemo/route-search-upstream-error-visibility`, 커밋 `4968097`.

**보안 함정 (테스트로 고정함)**
오류 객체를 통째로 로그에 찍으면 안 된다. `AxiosError.config`에는 요청에 쓴 API 키가 헤더·params로 그대로 들어 있다. 그래서 원본 AxiosError를 `cause`로도 넘기지 않고, 로그에는 `upstream`/`status`/`message`만 골라 남긴다. 이 규칙이 깨지는지 검사하는 테스트를 2개 넣었다.

**테스트 작성 중 잡은 거짓 통과**
키 노출 여부를 `JSON.stringify(error, Object.getOwnPropertyNames(error))`로 확인하려 했더니 테스트가 처음부터 통과했다. `JSON.stringify`의 2번째 인자로 배열을 주면 **replacer 배열**이 되어 모든 depth에서 그 키 목록만 남긴다. 그래서 `config.headers.Authorization`이 걸러져 "키 없음"으로 보였다. 중첩 객체의 값 노출을 검사할 때 이 패턴을 쓰면 안 된다. `error.config === undefined`처럼 구조 자체를 단언하는 쪽으로 바꿔 실패를 확인했다.

**교훈 일반화**
외부 API를 호출하는 코드에서 `catch {}`와 "오류를 빈 결과로 바꿔 반환"은 장애 시 진단을 원천 차단한다. 운영 로그에 근거가 없을 때는 로그를 더 뒤지기 전에 **그 코드가 애초에 로그를 남기는지부터 읽는다.**

---

## 2026-08-07 — grep·typecheck·테스트 개수로는 "사라진 것"을 잡지 못한다. 병합 검증은 diff 라인 수부터 본다

**증상**
Task 16(PR #3 프론트엔드 충돌 해소)에서 Reviewer 서브에이전트가 독립 재검증 후 `APPROVE`, "발견한 문제: 없음(치명적/경미 모두)"으로 보고했다. 실제로 Reviewer가 실행한 검증은 전부 통과한 것이 맞았다 — `apiClient.realtime.createSession` 존재 확인, `expo-constants` 존재 확인, WebRTC 버전 고정 확인, `MOCK_*` grep 0건, 충돌 마커 0건, `pnpm -r typecheck` 통과, 서버 테스트 98/98.

그런데 Director가 `git diff <base> -- apps/mobile/src/api/client.ts`를 직접 읽으니 한 줄이 삭제돼 있었다.

```
-      // 하차벨 요청은 PATCH /status 응답으로 자동 생성되므로 별도 request 호출이 없다.
```

`ApiError`/`request()`는 `claude` 쪽을 채택하라는 지시였는데, 이 주석 한 줄만 PR #3 쪽(주석 없는 버전)이 채택된 결과였다.

**원인**
Reviewer의 검증 항목이 전부 **"존재해야 할 것이 존재하는가"** 형태였다. `grep`으로 심볼을 찾고, typecheck로 import 정합성을 보고, 테스트 개수가 줄지 않았는지 확인한다. 이 방식은 기능 손실은 잡지만 **주석·로그 문구·죽은 코드처럼 어떤 심볼도 참조하지 않는 것이 사라지는 것은 원리적으로 잡지 못한다.** 검증 목록에 없는 것은 검증되지 않는다. 병합에서 사라지는 것은 미리 목록에 적어둘 수 없다는 게 문제의 핵심이다.

**검증된 해결책**
병합 결과 검증에서는 **먼저 `--stat`으로 파일별 증감 라인 수를 보고, 예상과 다른 파일은 실제 diff를 라인 단위로 읽는다.**

```bash
git diff <base> --stat
git diff <base> -- <의심스러운 파일>
```

이번 경우 `--stat`이 곧바로 답을 줬다.

```
apps/mobile/src/api/client.ts | 1 -
apps/mobile/package.json      | 1 +
```

`client.ts`가 `-1줄`이라는 사실 하나가 두 가지를 동시에 증명한다. **(1) `apiClient.realtime` 블록은 온전하다** — 사라졌다면 대량 삭제로 나타났을 것이다. grep보다 강한 증거다. **(2) 그럼에도 뭔가 한 줄이 사라졌다** — 이 파일은 순수 union이어야 했으므로 삭제가 0줄이어야 정상이다. 같은 논리로 `package.json`의 `+1`(= `react-native-ble-plx` 추가만)이 `expo-constants`와 WebRTC 고정 버전이 손대지지 않았음을 증명했다.

**교훈 일반화**
서브에이전트에게 검증을 위임할 때 "X가 있는지 확인하라"만 지시하면 X만 확인된다. 병합처럼 **손실이 주된 위험인 작업**에서는 존재 확인 목록에 더해 **"base 대비 삭제된 줄 전체를 읽고 각각이 의도된 삭제인지 판정하라"**를 명시해야 한다. 그리고 Director는 Reviewer의 `APPROVE`와 무관하게 라인 단위 diff를 직접 본다 — Reviewer가 실행한 명령이 전부 통과했다는 것과 검증이 충분했다는 것은 다른 말이다.

**관련 파일**
- `personal-notes/CODEX_HANDOFF.md` 3절 Task 16, 6-A.5, 7절
- `apps/mobile/src/api/client.ts` (worktree `.worktrees/chaerin-frontend-merge`, 커밋 `7881ad6`)

---

## 2026-08-06 — `git stash -u`는 일부 실패해도 성공한 것처럼 보인다. drop 전 반드시 전체를 확인한다

**증상**
메인 checkout에서 PR #3 충돌을 실제로 재현해보려고 스크래치 `git merge --no-commit`을 돌리기 전에, 작업 중이던 tracked 편집(`REMAINING_CHECKLIST.md`)을 치우려고 `git stash push -u`를 실행했다.

```
Saved working directory and index state On ...: wip: gbis occupancy checklist note
warning: failed to remove .agents/skills/grill-me/agents: Permission denied
(다른 untracked 디렉터리도 같은 오류)
```

메시지는 "저장 완료"처럼 보였지만 명령 자체는 exit code `1`을 반환했다. 그런데 `git status`를 보니 `REMAINING_CHECKLIST.md`가 여전히 수정된 상태로 남아 있었다. "stash가 안 먹혔나 보다, 중복이니 지워도 되겠다"고 판단해 `git stash drop`을 실행했다.

**원인**
`git stash push -u`는 tracked 변경과 untracked 파일을 **하나의 스태시**로 묶지만 내부적으로는 커밋이 여러 개다(부모 순서로 HEAD, index 상태, **untracked 파일 트리**). untracked 디렉터리 일부(`.agents/skills/...`)를 작업 트리에서 지우는 단계가 권한 오류로 실패해서 명령 전체가 실패로 보고됐지만, **tracked 파일 하나만 보고 "전체가 실패했다"고 결론 내린 게 틀렸다.** 실제로는 다른 untracked 파일들(`lessons.md`, `.mcp.json`, `skills-lock.json`, `personal-notes/BACKEND_HANDOFF_2026-07-27/08-01/08-04.md`)은 이미 작업 트리에서 조용히 삭제된 상태였다. 그 상태에서 stash를 drop하니 유일한 사본이 사라졌다.

**검증된 해결책**
drop한 지 얼마 안 됐다면(gc 전) 복구 가능하다. drop 시 출력되는 해시를 그대로 조사한다.

```bash
git cat-file -p <드롭된 stash 해시>          # parent 3개 확인 (HEAD, index, untracked)
git cat-file -p <3번째 parent>               # untracked 파일 트리
git ls-tree <3번째 parent>                   # 뭐가 들어있는지 확인
git checkout <3번째 parent> -- <복구할 경로들>
git reset -- <복구할 경로들>                  # 다시 untracked 상태로
```

전량 복구 확인함(2026-08-06). 심지어 메인 checkout의 `lessons.md`가 다른 worktree의 `lessons.md`와 완전히 다른 내용(별도로 진화한 파일)이었다는 것도 이 과정에서 드러났다 — 복구 안 했으면 그 내용은 영구 손실이었다.

**교훈 일반화**
`git stash -u`가 일부 untracked 파일 삭제에 실패해도 명령 자체는 "저장 완료" 메시지를 내고, `git status`로 tracked 파일 하나만 확인하면 "전체가 안 됐다"는 잘못된 결론에 이르기 쉽다. **`drop`하기 전에는 반드시 `git stash show -p --include-untracked stash@{0}`(또는 `git stash show --include-untracked -p`)로 tracked·untracked 변경 전체를 확인한다.** 특히 Windows에서 다른 프로세스가 파일을 잠그고 있거나(`.agents/`, `.claude/` 같은 스킬 캐시 디렉터리) 권한 문제가 있는 디렉터리가 섞여 있으면 이 문제가 재현되기 쉽다.

**관련 파일**
- `personal-notes/CODEX_HANDOFF.md` 0절, 8절, 9절

---

## 2026-08-06 — 환경변수 "미설정" 테스트에서 `undefined`를 넘기면 기본값이 되살아난다

**증상**
Task 15(realtime 병합 충돌 해소)에서 `OPENAI_API_KEY` 미설정 시 502를 확인하는 테스트를 추가했다.
상태 코드·`errorCode` 단언은 통과했는데 "upstream을 호출하지 않았다"는 단언(`calls === 0`)만 `1 !== 0`으로 실패했다.

```
✖ fails realtime session with 502 when OPENAI_API_KEY is missing
  AssertionError: Expected values to be strictly equal: 1 !== 0
```

**원인**
테스트 헬퍼 시그니처가 이랬다.

```ts
function setRealtimeEnv(sharedSecret: string | undefined, openAiApiKey: string | undefined = "sk-test")
```

호출부는 `setRealtimeEnv("server-secret", undefined)`로 "키를 지워라"를 의도했지만,
JS/TS 기본 매개변수는 인자가 `undefined`일 때 **정확히 그때** 적용된다.
명시적으로 넘긴 `undefined`도 기본값 `"sk-test"`로 대체되어 키가 지워지지 않았다.
그래서 서비스가 실제로 OpenAI를 호출했고, 그 호출이 stub에서 예외를 던져 catch로 502가 나왔다.
**상태 코드만 봤으면 통과한 것처럼 보였을 오탐이다.** 계약 검증이 아니라 우연히 같은 결과가 나온 것이다.

**검증된 해결책**
"값 없음"을 표현할 때 기본값이 있는 매개변수에 `undefined`를 쓰지 않는다. `null`을 sentinel로 쓴다.

```ts
// null 을 넘기면 삭제, 생략하면 기본값
function setRealtimeEnv(sharedSecret: string | undefined, openAiApiKey: string | null = "sk-test") {
  if (openAiApiKey === null) delete process.env["OPENAI_API_KEY"];
  else process.env["OPENAI_API_KEY"] = openAiApiKey;
}
```

수정 후 서버 테스트 93/93 통과(`node --import tsx --test $(find src -name '*.test.ts')`, exit 0).

**교훈 일반화**
외부 호출 실패 경로 테스트에는 상태 코드 단언만 두지 말고 **"upstream이 호출되지 않았다"는 호출 횟수 단언을 함께 둔다.**
그 단언이 없었으면 이 버그는 초록불 뒤에 숨은 채 넘어갔다. 실패 경로가 여러 경로로 같은 응답을 만들 때는
"어느 경로로 실패했는가"를 반드시 별도로 검증한다.

**관련 파일**
- `apps/server/src/routes/realtime.test.ts` — `setRealtimeEnv`, `upstreamMustNotBeCalled`

---

## 2026-08-06 — barrel(index) 파일 충돌에서 한쪽을 통째로 채택하면 export가 조용히 사라진다

**증상**
Task 15에서 `packages/shared/src/index.ts`가 content 충돌로 잡혔다. 충돌 자체는 realtime 스키마 때문에 났지만,
incoming(유나) 쪽을 통째로 채택했다면 **realtime과 무관한** `export * from "./schemas/health.schema.js"` 한 줄이 함께 사라질 상황이었다.
그 줄이 없으면 병합된 `apps/server/src/routes/health.ts`와 `health.test.ts`가 `HealthResponse`/`HealthResponseSchema`를 못 찾아 컴파일이 깨진다.

**원인**
barrel 파일은 서로 무관한 여러 기능의 export가 한 파일에 모인다.
그래서 충돌 원인이 A 기능이어도 diff에는 B 기능의 export 증감이 함께 잡힌다.
`git diff ours incoming`에서 "incoming이 지웠다"처럼 보이는 줄이 실제로는 **incoming 브랜치가 아직 그 기능을 갖지 못했을 뿐**인 경우가 있다.
이때 "incoming 채택"이라는 한 줄짜리 규칙을 그대로 적용하면 우리 쪽에만 있던 기능이 사고로 삭제된다.

**검증된 해결책**
barrel/index 파일이 충돌 목록에 있으면 파일 단위로 한쪽을 고르지 말고 **export 집합을 줄 단위로 대조**한다.

```bash
git diff HEAD:packages/shared/src/index.ts <incoming>:packages/shared/src/index.ts
```

없어지는 줄마다 "이 기능이 incoming에 존재하는가"를 따로 확인하고, 존재하지 않으면 그 줄은 유지한다.
이번에는 `constants/realtime.js`(의도적으로 삭제)와 `health.schema.js`(반드시 유지)를 갈라내는 데 이 대조가 필요했다.
검증: 해소 후 `pnpm -r typecheck` exit 0, 서버 테스트 93/93 pass, `health.test.ts`가 shared의 `HealthResponseSchema`를 정상 import.

**관련 커밋**
- `04a60ae` (merge: resolve realtime session conflicts on the shared contract)

---

## 2026-08-06 — Supabase `list_tables`의 행 수는 추정치다. 검증에 쓰면 안 된다

**증상**
Task 13(`PROD-REST-SUPABASE-E2E-GATE`) 운영 E2E 검증에서 Implementer와 Tester가 각각 독립적으로
"네 테이블 전체 행 수 = `trips 2 / trip_status 2 / location_logs 22 / bell_logs 2`이며 이번 Task의 test 운행 2건 합계와 정확히 일치한다"고
보고했다. 두 역할 모두 이 값을 "예상 밖의 행이 없다"는 격리 근거로 삼았다.
Reviewer가 같은 항목을 재검증했을 때 실제 값은 `3 / 3 / 33 / 3`이었다.

**원인**
`mcp__supabase__list_tables`가 돌려주는 행 수는 `live_rows_estimate`, 즉 `pg_class.reltuples` 기반 **통계 추정치**다.
마지막 `ANALYZE`/autovacuum 시점에 따라 실제 값과 다르며, 최근 INSERT가 반영되지 않을 수 있다.
Implementer와 Tester는 이 추정치를 정확한 `count(*)`로 오인해 인용했다.
그 결과 `2026-06-30`에 생성된 기존 운행 `trip-demo-1551-...`을 아무도 발견하지 못했고,
`CURRENT_TASK.md`의 "작업 시작 시 네 테이블 행 수: 모두 0"이라는 사전 확인 기록도 틀린 채로 남아 있었다.

**검증된 해결책**
행 수를 검증 근거로 쓸 때는 `list_tables`를 쓰지 말고 `execute_sql`로 실제 집계를 조회한다.

```sql
select 'trips' as t, count(*)::int as total from public.trips
union all select 'trip_status',   count(*)::int from public.trip_status
union all select 'location_logs', count(*)::int from public.location_logs
union all select 'bell_logs',     count(*)::int from public.bell_logs
```

Director가 이 쿼리로 직접 확인해 `3 / 3 / 33 / 3`을 재현했고, orphan 운행의 `trip_id`와 `created_at`까지 특정했다.
`list_tables`는 스키마·컬럼·RLS 확인 용도로만 쓴다.

**파급 효과 — 이게 왜 위험했나**
운영 테스트 데이터 cleanup의 성공 기준을 "삭제 후 전체 행 수 = 0"으로 잡을 뻔했다.
orphan 행 때문에 그 기준은 절대 충족되지 않고, 기준을 맞추려다 승인 범위 밖의 행을 지울 수 있었다.
**운영 데이터 정리의 성공 기준은 언제나 "대상 exact ID의 행 수 = 0"이지 "테이블 전체 행 수 = 0"이 아니다.**

**교훈 일반화**
서브에이전트 둘이 같은 값을 독립적으로 보고해도, 둘 다 같은 잘못된 출처를 인용했다면 교차검증이 되지 않는다.
"두 역할이 동의함"은 "서로 다른 방법으로 확인함"과 다르다. 파괴적 작업 직전의 수치는 Director가 직접 조회한다.

**관련 파일**
- `.agent-loop/CURRENT_TASK.md` — "사전 확인 결과" 절의 정정 블록, "재시도 1 Phase B" 절

---

## 2026-08-06 — `git fetch origin`이 `origin/yemo-develop`을 갱신하지 않는다 (refspec 손상)

**증상**
`origin/yemo-develop` 추적 ref가 `1d9a3a5`에 멈춰 있는데 Render 배포 커밋은 `9b1fb09`였다.
이전 handoff는 이를 "배포 커밋보다 4개 뒤에 있는 stale ref"라고만 적고 원인을 특정하지 못했다.
`git fetch origin`을 실행해도 갱신되지 않았고, 출력에는 엉뚱하게
`* branch yemo/be16-api-state-test-coverage -> FETCH_HEAD` 한 줄만 나왔다.

**원인**
이 저장소의 fetch refspec이 브랜치 하나만 가리키도록 좁혀져 있다.

```
remote.origin.fetch = +refs/heads/claude/nice-archimedes-iv7iu0:refs/remotes/origin/claude/nice-archimedes-iv7iu0
```

표준값인 `+refs/heads/*:refs/remotes/origin/*`가 아니라서 `git fetch origin`은
`claude/nice-archimedes-iv7iu0` 외의 어떤 remote-tracking ref도 갱신하지 않는다.
원격 브랜치가 뒤처진 게 아니라 **로컬이 원격을 못 보고 있었다.**

**검증된 해결책**
원격의 진짜 상태는 refspec을 타지 않는 `git ls-remote`로 확인한다.

```bash
git ls-remote --heads origin
```

이걸로 `refs/heads/yemo-develop = 9b1fb092...`를 확인했고, 배포 커밋과 정확히 일치했다.
특정 브랜치와 비교할 때는 브랜치를 명시해 fetch한 뒤 `FETCH_HEAD`로 비교한다.

```bash
git fetch origin yemo-develop
git rev-list --left-right --count FETCH_HEAD...HEAD
git log --oneline HEAD..FETCH_HEAD
```

이 방법으로 현재 checkout이 통합 브랜치보다 3커밋 뒤이고 자체 커밋은 0개(이미 병합됨)라는 걸 확인했다.

근본 수정은 refspec 복구지만 로컬 설정 변경이라 사용자 확인 후 수행한다.

```bash
git config --replace-all remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git fetch origin --prune
```

**2026-08-10 수행 완료.** 사용자 승인 후 위 두 줄을 실행했다.
설정이 `+refs/heads/claude/nice-archimedes-iv7iu0:refs/remotes/origin/claude/nice-archimedes-iv7iu0`
에서 `+refs/heads/*:refs/remotes/origin/*`로 바뀌었고, 원격 10개와 로컬 `origin/*` 10개가
SHA까지 전부 일치하는 것을 대조로 확인했다(`origin/HEAD -> origin/main`은 심볼릭 ref라 별개).
**이제 `git log origin/<브랜치>`와 ahead/behind 계산을 그대로 믿어도 된다.**

수정 직전에 이 결함이 실제로 한 번 더 터졌다. 원격 브랜치 7개를 `git push origin --delete`로 지운 뒤
`git fetch origin --prune`을 돌렸는데 **로컬 `origin/yemo/*` 7개가 그대로 남았다** — `--prune`은
refspec이 덮는 범위만 청소하므로 좁은 refspec에서는 유령 ref를 못 지운다.
그때는 `git branch -r -d origin/<이름>`으로 하나씩 지워야 했다.

**왜 위험했나**
`git log origin/yemo-develop`, `git diff origin/yemo-develop`, ahead/behind 계산이 전부 조용히 틀린 답을 준다.
"내 브랜치가 1커밋 앞서 있다"고 읽었지만 실제로는 3커밋 뒤였고 내 작업은 이미 병합돼 있었다.
이 상태에서 새 기능 브랜치를 따면 3커밋 분량의 작업이 빠진 베이스에서 시작한다.

**교훈 일반화**
remote-tracking ref는 캐시다. 최신이라는 보장이 없고, fetch가 그것을 갱신한다는 보장도 없다.
브랜치 관계가 판단의 근거가 될 때는 `ls-remote`나 명시적 fetch로 원본을 확인한다.

---

## 2026-08-10 — OneDrive + pnpm worktree는 `git worktree remove`가 두 단계로 실패한다

**증상**
병합이 끝난 worktree 6개를 정리하려고 `git worktree remove`를 돌렸더니 서로 다른 오류 두 종류가 났다.

```text
error: failed to delete '.../.worktrees/docs-sync': Permission denied
error: failed to delete '.git/worktrees/docs-sync': Permission denied
```

```text
error: failed to delete '.../.worktrees/chaerin-frontend-merge': Filename too long
```

**더 나쁜 것은 실패가 깨끗하지 않다는 점이다.** git은 worktree 안의 `.git` 파일을 먼저 지운 뒤
디렉터리 삭제에서 실패했다. 그 결과 `git worktree list`에서는 사라졌는데 파일 166개가 든 디렉터리와
`.git/worktrees/<name>` 관리 항목은 그대로 남는 **반쯤 제거된 상태**가 됐다.
"실패했으니 아무것도 안 바뀌었겠지"라고 넘기면 안 된다.

**원인 두 가지**

1. `Permission denied` — 프로젝트가 OneDrive 안에 있어서 하위 디렉터리가 "파일 온디맨드"
   자리표시자다. 속성이 `ReadOnly, Directory, ReparsePoint`라 unlink가 거부된다.
   **저장소의 `.git/worktrees/` 관리 폴더도 같은 상태**라 작업 트리를 지워도 관리 항목이 남는다.
2. `Filename too long` — `node_modules`가 설치된 worktree는 pnpm 중첩 경로가 Windows MAX_PATH를
   넘긴다. `Remove-Item -Recurse -Force`도 같은 이유로 실패한다.

**검증된 해결책**

ReadOnly부터 푼다. 작업 트리와 `.git/worktrees/` 양쪽 모두 해야 한다.

```powershell
$p = "<worktree 경로>"
Get-ChildItem -Path $p -Recurse -Force | ForEach-Object { try { $_.Attributes = 'Normal' } catch {} }
(Get-Item $p -Force).Attributes = 'Normal'
```

`node_modules`가 있으면 robocopy 미러로 비운 뒤 지운다. 긴 경로를 처리하는 유일한 기본 도구다.

```powershell
robocopy <빈 디렉터리> <대상> /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
Remove-Item -Path <대상> -Recurse -Force
```

**robocopy의 종료 코드 0이 아닌 것을 실패로 읽지 마라.** 이번에 exit 2로 "실패" 알림이 왔지만
실제로는 3개 모두 삭제에 성공했다. robocopy는 0=변경 없음, 1=복사함, 2=추가 항목 정리함이며
**8 이상만 오류**다. 스크립트 종료 코드가 robocopy 값을 그대로 물려받으니 출력을 직접 확인한다.

마지막에 남은 관리 항목을 정리한다.

```bash
git worktree prune -v
```

**순서를 지키면 반쯤 제거된 상태를 안 만든다**: ReadOnly 해제 → (node_modules 있으면) robocopy →
`git worktree remove` → `git worktree prune`.

**부수 확인**: auto mode 권한 분류기가 `git worktree prune`, `Remove-Item -Recurse -Force`,
반복문으로 감싼 삭제를 전부 자동 거부한다. `acceptEdits` 모드로 바꾸면 승인 프롬프트로 바뀐다.
handoff 8절의 Supabase DELETE 사례와 같은 패턴이다.

---

## 2026-09-01 — 빈 배열 하나로 "없다"와 "확인 못 했다"를 겸하면, fail-closed가 거짓 안내로 바뀐다

**증상**
예외사항 3번(“버스 놓쳤어요” → `GET /api/trips/{tripId}/status`가 GBIS를 재조회)의 미커밋 구현에서,
서비스가 `arrivals.length > 0 ? "AVAILABLE" : "NO_VEHICLE"`로 상태를 정하고 있었다. 테스트 207개는
전부 통과했고 typecheck도 통과했다 — 서비스 단위 테스트가 `getArrivals`를 직접 mock 해서
"빈 배열 = 차량 없음"이라는 전제를 그대로 재현했기 때문이다.

**원인**
`getArrivalInfo()`(`apps/server/src/adapters/routes/hyorin-route-search.adapter.ts`)는 서로 다른 세 가지
이유로 `arrivals: []`를 반환한다.

1. GBIS 정상 응답 + 해당 노선 레코드 없음 → 진짜로 차가 없다
2. 회차 노선 방향 판별에 필요한 `busrouteservice` 조회 실패·빈 응답 → `lookupRouteStations()`가
   예외를 **내부에서 삼키고** `{ verified: false }`를 돌려준다 (PR #33의 fail-closed 설계)
3. 목적지 기준 방향을 확정하지 못함(`matched === undefined`)

2·3번은 "확인하지 못했다"인데 호출자에게는 1번과 똑같이 보인다. 서비스의 `try/catch`는 던져진
예외만 `UPSTREAM_ERROR`로 접으므로, 삼켜진 실패는 전부 `NO_VEHICLE`이 됐다. 버스를 놓친 사용자에게
"그 노선은 이제 오지 않는다"로 안내되는 값이다. 공개 계약(`docs/API_SPEC.md`)이 `NO_VEHICLE`을
"정상 조회되었지만 차량이 없음"으로 정의하고 있으니 계약 위반이기도 하다.

**검증된 해결책**
어댑터가 판단 근거를 함께 반환하게 했다. `getArrivalInfo()` 반환값에
`lookupStatus: "AVAILABLE" | "NO_VEHICLE" | "UNVERIFIED"`를 추가하고, 서비스가 `UNVERIFIED`를
`UPSTREAM_ERROR`로 매핑한다. `arrivals`는 그대로 비워 fail-closed 동작을 유지한다.
라우트의 wrapper는 `info.arrivals`만 꺼내던 것을 `getArrivalInfo(candidate)` 그대로 넘기도록 줄여,
분류 판단이 테스트 가능한 서비스 한 곳에만 남게 했다.

TDD로 먼저 실패 테스트 5개(어댑터 4 + 서비스 1)를 작성해 `lookupStatus === undefined`로 실패하는
것을 확인한 뒤 구현했다. 서버 테스트 213/213 pass, `pnpm typecheck` 3/3 통과.

**같은 작업에서 잡은 두 번째 결함 — 공유 스키마가 두 엔드포인트를 겸한다**
`TripStatusResponseSchema`에 `arrivals`/`arrivalStatus`를 **필수**로 추가했는데, 앱은
`GET /status`와 `PATCH /status` 응답을 **같은 `TripStatusResponse` 타입**으로 받는다
(`apps/mobile/src/api/client.ts`의 `getStatus`/`updateStatus`). PATCH 응답에는 두 필드가 없으므로
타입이 거짓말을 하게 된다. 런타임 검증이 아니라 제네릭 캐스트라 typecheck는 통과했다 —
그래서 아무도 못 봤다. `PATCH` 응답 본문을 `TripStatusResponseSchema.parse()`로 검증하는 테스트를
추가해 실패를 확인한 뒤 두 필드를 `.optional()`로 바꿨다.

**교훈 일반화**
- 실패를 삼켜 정상값으로 접는 함수는, 접은 사실 자체를 반환값에 남겨야 한다. 그러지 않으면
  fail-closed 안전장치가 한 단계 위에서 **거짓 사실 안내**로 바뀐다. `catch {}` 문제
  (2026-08-07 항목)의 반환값 판이다.
- 의존성을 mock 하는 단위 테스트는 mock에 심은 전제까지 검증해 주지 않는다. mock 하는 함수의
  실제 반환 경로를 한 번은 읽어야 한다.
- 여러 엔드포인트가 공유하는 응답 스키마에 필드를 **필수로** 추가하기 전에 그 타입의 소비자를
  전부 확인한다. 제네릭 캐스트(`request<T>()`)로 소비하는 쪽은 typecheck가 잡아주지 않는다.

---

## 2026-09-05 — 서버는 도착정보를 갱신하는데 AI는 계속 최초 값을 말한다

**증상.** 시연 중 노선 선택 직후 AI가 "약 5분 후 도착"이라고 안내한 뒤, 실제 도착정보가
3분·2분으로 바뀌어도 계속 5분이라고 말했다. 서버 캐시와 GBIS 조회는 정상 동작했다.

**원인 — 마지막 두 구간이 끊겨 있었다.**

1. `RidingScreen`의 주기 `GET /status` 폴링은 응답을 화면 state와 `UPDATE_TRIP_STATUS`에만
   반영하고 `session.notifyStatusChange()`를 호출하지 않았다. 3초 GPS `PATCH` 경로만 세션에
   알리고 있었는데, 도착정보는 `GET` 응답에만 실린다. 즉 **갱신값이 지나가는 유일한 경로가
   세션에 연결되지 않은 유일한 경로**였다.
2. 전역 프롬프트에 "도착 예정 시간은 `create_trip` 응답의 `arrivals`만 사용한다"가 남아 있어,
   설령 최신값이 전달돼도 모델이 최초 값을 쓰도록 지시받고 있었다.

**검증된 해결책.** 폴링 응답을 `toTripStatusSnapshot()`으로 감싸 세션에 직접 전달하고,
`get_trip_status` 전용 response instructions로 "방금 받은 결과만 근거"를 못박았다. 전역
프롬프트의 `create_trip` 전용 문장은 "선택 직후는 `create_trip`, 이후 질문은 최신
`get_trip_status`"로 바꿨다. 서버 테스트 277/277 pass, `pnpm typecheck` 3/3, 서버 build 통과.

**함께 잡은 것 — 값이 없는 응답이 최신값을 지운다.**
도착정보 네 필드는 `GET /status`의 `WAITING_BUS` 응답에만 있고 3초 주기 `PATCH` 응답에는 없다.
응답을 그대로 덮어쓰면 방금 받은 3분이 곧바로 `undefined`가 된다. reducer와 Event Dispatcher
양쪽에 같은 규칙을 뒀다 — 있으면 교체, 없고 대기 상태도 벗어났으면 정리, 없지만 대기 중이면 유지.
Event Dispatcher에서 이걸 빠뜨리면 임박 안내가 두 번 나간다(2분에 한 번, PATCH가 기억을 지운
뒤 1분에 또 한 번).

**환경 특이사항 — `tsx --test`는 `.js` 안의 JSX를 읽지 못한다.**
`TripContext.js`는 확장자가 `.js`인데 JSX를 담고 있다. Expo는 babel-preset-expo로 처리하지만
esbuild(=tsx)의 `.js` 로더는 JSX를 켜지 않아
`ERROR: The JSX syntax extension is not currently enabled`로 실패한다. reducer 전이 규칙을
테스트하려면 화면 렌더링과 분리해야 해서, `initialState`와 `tripReducer`를 JSX가 없는
`state/trip-reducer.js`로 옮기고 `TripContext.js`는 Provider만 남겼다. 먼저 **전이를 바꾸지 않는
순수 이동**만 하고 기존 테스트가 그대로 통과하는 것을 확인한 뒤 동작을 추가했다.
앱 상태 로직을 테스트하고 싶은데 파일이 JSX를 품고 있으면 같은 방법을 쓴다.

**교훈 일반화**
- "서버는 맞는데 사용자에게 안 보인다"류 문제는 각 구간을 따로 보지 말고 **구간 사이의 이음매**를
  먼저 의심한다. 여기서는 두 이음매(앱→세션, 세션→모델 지시)가 동시에 끊겨 있었다.
- 어떤 데이터가 특정 응답에만 실린다면, 그 데이터를 소비하는 코드에는 반드시 "없는 응답이
  왔을 때" 규칙이 있어야 한다. 없으면 `undefined` 덮어쓰기로 조용히 사라진다.
- 진단 로그는 구간 경계마다 같은 식별자로 남겨야 쓸모가 있다. 로그 하나로는 어디서 끊겼는지
  알 수 없다(`docs/ARRIVAL_POLLING.md`의 8단계 순서).

---

## 2026-09-05 — 프롬프트로 세 번 조여도 안 되면 규칙이 아니라 방식이 틀린 것이다

**증상.** 시연에서 AI가 노선 번호를 계속 틀리게 읽었다. `35`를 "셋다섯", `15-2`를 "일번",
`82-1`을 "팔십이번"으로 말했다. 잘못 읽은 정도가 아니라 하이픈 뒤 숫자를 통째로 빼먹었다.
시각장애인 사용자는 이 음성만으로 버스를 고르므로 그대로 다른 버스를 탄다.

**원인.** 발음 규칙 자체는 이미 충분히 자세했다. `guide.ts`에 11줄, `function-dispatcher.ts`의
공통 지시문에 또 한 벌. 하이픈 분리, 자릿수별 읽기, "다시" 읽기, 생략 금지까지 다 있었다.
**같은 규칙을 최소 세 차례 조여 넣었는데도 계속 틀렸다는 것이 진짜 단서였다.** 문제는 규칙의
내용이 아니라 "모델이 매 발화마다 문자열을 파싱해 발음을 계산하게 한다"는 방식이었다.
지시 따르기는 확률적이라 규칙을 아무리 정교하게 써도 보장이 되지 않는다.

**검증된 해결책.** 발음을 코드로 확정했다. `@bus-ta/shared`의 `toSpokenRouteNo()`가 순수
함수로 변환하고, Dispatcher가 Function 결과에 `routeNoSpoken`을 붙여 보낸다. 모델에게는
"그 문자열을 그대로 읽어라"만 시킨다. 지시 따르기 문제가 결정적인 변환 문제로 바뀌어서
`35 → 삼십오`, `15-2 → 십오 다시 이`, `82-1 → 팔십이 다시 일`, `1551B → 일 오 오 일 비`를
전부 테스트로 고정할 수 있게 됐다. 서버 테스트 319/319 통과, typecheck 3/3, build 통과.

`routeNoSpoken`은 모델에게 보내는 payload에만 두고 서버 응답·공개 API 계약에는 넣지 않았다.
발음은 안내 계층의 관심사라 백엔드 계약을 늘릴 이유가 없다.

**교훈 일반화**
- 같은 프롬프트 규칙을 두 번 이상 조였는데도 같은 증상이 나오면, 규칙을 세 번째로 다듬지
  말고 그 일을 코드로 옮길 수 있는지 먼저 본다. 결정적으로 계산할 수 있는 것을 모델에게
  시키고 있지 않은지 의심한다.
- 모델의 출력 형식이 안전에 직결되면(번호·금액·용량) 프롬프트가 아니라 데이터로 내려준다.
- 프롬프트를 걷어낼 때 "말하는 규칙"과 "알아듣는 규칙"을 구분한다. 발음 계산은 코드로
  옮겼지만, 사용자가 "칠백 다시 이"라고 말한 것을 700-2로 알아듣는 규칙은 여전히 필요하다.
