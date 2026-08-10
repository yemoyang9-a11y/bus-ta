# Lessons

작업 중 발견하고 **검증까지 끝난** 오류와 해결책을 누적한다. 추측만 하고 확인하지 못한 원인은 적지 않는다.

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

**왜 위험했나**
`git log origin/yemo-develop`, `git diff origin/yemo-develop`, ahead/behind 계산이 전부 조용히 틀린 답을 준다.
"내 브랜치가 1커밋 앞서 있다"고 읽었지만 실제로는 3커밋 뒤였고 내 작업은 이미 병합돼 있었다.
이 상태에서 새 기능 브랜치를 따면 3커밋 분량의 작업이 빠진 베이스에서 시작한다.

**교훈 일반화**
remote-tracking ref는 캐시다. 최신이라는 보장이 없고, fetch가 그것을 갱신한다는 보장도 없다.
브랜치 관계가 판단의 근거가 될 때는 `ls-remote`나 명시적 fetch로 원본을 확인한다.
