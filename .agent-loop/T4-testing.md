# T4 독립 시험 — 2026-09-23

판정: **PASS — 혼합 경로 검색/안내/운행 생성 차단 및 조회 회귀의 로컬 검증 범위.** 관련 시험 **181/181**, shared/server/mobile 타입 검사, 전체 tracked diff 공백 검사가 통과했다. 실물·실시간 외부 API·운영 DB 성공을 의미하지 않는다.

WT: `C:\Users\yemoy\OneDrive\문서\한이음\.worktrees\rehearsal-20260922`. `.agent-loop/T4-brief.md`, `T4-implementation.md`와 최종 구현/시험을 읽고 독립 실행했다. T2 P2 보완 재검증 보고서를 동결한 뒤 T4를 검증했다. 과거 구현자의 phase A/B 수치나 T2 시험 수를 아래 수치에 합산하지 않는다.

## 직접 실행한 검증

작업 디렉터리 `apps/server`:

```powershell
$testOutput = & node node_modules/tsx/dist/cli.mjs --test src/adapters/routes/hyorin-route-search.adapter.test.ts src/adapters/routes/multimodal-route.test.ts src/adapters/routes/arrival-direction-boundaries.test.ts src/services/guide.test.ts src/services/multimodal-guide.test.ts src/services/trip/create-trip.service.test.ts src/services/route/search-routes.service.test.ts src/routes/route-search-provider.test.ts src/services/arrival/arrival-cache.test.ts src/integration/route-number-speech.test.ts src/integration/mobile-function-dispatcher.test.ts src/integration/mobile-multimodal-route.test.ts 2>&1
$testExit = $LASTEXITCODE
if ($testExit -eq 0) { $testOutput | Select-Object -Last 12 } else { $testOutput }
exit $testExit
```

결과: **181 tests / 181 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo, exit 0**. 직접 실행 출력 chunk `fc21de`, duration 2049ms. 설치된 tsx CLI를 Node로 직접 실행했으며 Windows child-process 제약 때문에 승인된 `require_escalated`를 사용했다.

worktree root에서 각각 독립 실행:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
git -c core.safecrlf=false diff --check
```

| 검사 | 결과 | 직접 실행 증거 |
| --- | --- | --- |
| shared 타입 | PASS, exit 0, 진단 없음 | `f0cfc9` |
| server 타입 | PASS, exit 0, 진단 없음 | `d88f3d` |
| mobile 타입 | PASS, exit 0, 진단 없음 | `31f89b` |
| 전체 tracked diff 공백 | PASS, exit 0, 출력 없음 | `b8baf4` |

앞선 T2 구현 보고에 기록된 T4 시험 파일의 optional response 타입 오류는 이번 server 전체 타입 검사에서 재현되지 않았다. 이번 시험은 지정한 12개 파일의 181개이며 전체 서버/scripts suite를 실행했다고 주장하지 않는다. diff 검사는 untracked 파일을 포함하지 않으므로 새 시험 파일은 실제 실행과 타입 검사 및 소스 대조로 확인했다.

## 요구 조건별 증거

| 요구 조건 | 실제 실행 및 소스 대조 |
| --- | --- |
| 기본 직행 및 명시적 혼합 범위 | `multimodal-route.test.ts`에서 기본 DIRECT_BUS가 단일 버스 및 개별 lane을 보존하고, MULTIMODAL 설정에서 버스+지하철을 반환하되 지하철 단독을 제외했다. 실제 adapter는 매 검색에서 SCOPE를 읽는다. PASS. |
| 공개 계약과 전체 구간 | 실제 adapter 반환값을 공유 RouteCandidateSchema로 검증했다. 순서 있는 WALK/SUBWAY/BUS 구간과 노선 정보가 유지되고 JSON에 pathType/trafficType가 없었다. adapter의 숫자형 원본 해석은 내부에만 있다. PASS. |
| 첫 버스 호환 필드 | 버스 3구간 경로의 stationList/destinationStation은 첫 버스만 표현하고 전체 마지막 도착점은 segments에 남는다. 버스 뒤 지하철이 이어져 첫 버스 하차점이 목적지에서 멀어도 후보를 유지한다. 잘못된 버스 식별자/좌표는 후보에서 제외했다. PASS. |
| 전체 구간 안내 | 실제 서버 guide 함수에 버스만 언급한 모델 결과를 주입해도 반환 guideMessage에 도보→지하철→버스→최종 도착 구간이 순서대로 포함된다. 모델 결과가 없을 때도 전체 구간과 안내 전용 문구를 유지한다. 같은 버스 번호에 서로 다른 지하철이 붙은 경로는 별도 후보로 남는다. PASS. |
| 실제 RouteList 카드/선택 차단 | 실제 화면 소스를 transpile하여 renderItem과 onPress를 실행했다. routeMode MULTIMODAL / tripSupported false / busTransitCount 2 각각에서 disabled뿐 아니라 콜백 직접 호출도 API 0·상태 변경 0·BLE scan stop 0·navigation 0이다. 전체 segments와 최종 목적지가 카드에 표시됐다. PASS. |
| 실제 음성 create_trip 차단 | 실제 Dispatcher에 candidateId만 전달해 모델이 metadata를 생략하는 경우를 실행했다. 앱에 저장된 세 가지 미지원 marker 각각으로 fetch 0, SELECT_ROUTE/START_TRIP 0, success false 및 안내 전용 설명을 반환했다. 모델 인자만 믿고 차단하는 구조가 아니다. PASS. |
| 음성 검색/다음 후보 안내 | 실제 다음 후보 결과에 routeMode/tripSupported/전체 segments와 버스별 routeNumbersSpoken이 유지됐다. 전역 guide와 Dispatcher의 검색/다음 후보/취소 후 후보 설명이 segments 전체와 안내 전용을 사용하도록 연결돼 있다. 새 혼합 자동 사례는 다음 후보를 직접 실행하고 검색/취소 경로는 기존 회귀 및 소스 대조로 확인했다. PASS. |
| 서버 생성 방어 | 실제 createTrip service에 미지원 marker 세 가지를 각각 전달해 400 INVALID_REQUEST, arrival lookup 0·저장 0을 확인했다. 공유 CreateTripRequestSchema가 explicit MULTIMODAL/false/버스 2개 이상을 거부한다. PASS, 아래 provenance 한계 참조. |
| 직행 호환 | 기존 메타데이터를 생략한 직행 계약과 service 201/초기 상태 시험이 통과했다. 실제 RouteList 직행 callback은 이전 scan을 중지하고 create 및 START_TRIP/Riding 이동을 수행했다. 기존 Dispatcher/노선 발음 회귀도 통과했다. PASS. |
| MOCK와 SCOPE 분리 | 실제 provider 함수가 import 이후 변경한 process.env를 요청마다 읽는 시험, MOCK 선택과 SCOPE 독립, 기존 시연 노선/fixture 비콘 매칭 시험이 통과했다. 실제 routes router가 handler 내부에서 provider를 호출함을 확인했다. PASS. |
| 방향 거리 경계 | 실제 getArrivalInfo 소비 경로에 synthetic axios 응답을 넣어 이름 불일치 99.9m는 AVAILABLE, 100.1m는 UPSTREAM_ERROR, 같은 이름은 거리와 무관하게 매칭됨을 확인했다. 정확한 100.0m 부동소수점 경계는 별도 실행하지 않았다. PASS. |
| 반복 목적지/순환 방향 | 목적지 3회가 하나의 선행 탑승 방향으로 모이면 해당 도착값만 반환하고, 서로 다른 방향이면 UPSTREAM_ERROR/빈 배열로 종료한다. 목적지가 탑승 이전에만 있는 순환 구간도 임의 wraparound를 추정하지 않았다. PASS. |
| cache refresh/오류/stale | 실제 ArrivalCache에 시간을 주입해 반복 refresh 최소 간격, 최초부터 UPSTREAM_ERROR, 성공 뒤 지속 실패, throw 실패, stale 배열 폐기 후 lastAttemptAt 하한 보존을 확인했다. 기존 목적지별 캐시 분리, 동시 조회 합치기, 로그 위생 및 30초 임박 정책 회귀도 통과했다. PASS. |
| 오류 위생·문서 계약 | Kakao 목적지 없음 오류에 원시 목적지 문자열이 포함되지 않는 시험이 통과했다. README/.env.example/API_SPEC/MODULE_CONTRACTS에서 MODE/SCOPE 구분, 첫 버스 필드/전체 segments, 안내 전용 차단, provenance 및 UPSTREAM_ERROR의 이전 arrivals 한계가 구현과 맞는지 확인했다. PASS. |

## 검증 한계 및 후속 확인

- **실시간 외부 API 호출 없음.** adapter는 실제 함수지만 Kakao/ODsay/GBIS는 axios stub, guide의 OpenAI 호출도 stub이다. 신규 방향 사례는 synthetic이며 기존 캡처 fixture 회귀와 구분한다. 실제 목적지·노선에서 반환되는 경로의 품질·현장 방향 정확도는 미검증이다.
- **실물 모바일 실행 없음.** RouteList의 실제 renderItem/onPress와 실제 Dispatcher를 실행하지만 RN 렌더러·API·BLE 경계는 대체한다. 실제 카드 배치/색/스크롤/TalkBack, 음성 인식/발음, Android 설치 및 실물 BLE E2E는 수행하지 않았다. 새 혼합 guide의 실제 모델 발화가 지침을 준수하는지도 이 시험만으로 증명하지 않는다.
- **서버 후보 provenance 검증은 없다.** 명시적인 미지원 marker 및 기존 stationList 계약 검증만 확인했다. 모든 환승 metadata를 지우고 직행 모양으로 만든 임의 요청을 검색 이력과 대조해 차단한다고 주장할 수 없다. 이는 brief에 명시된 현재 범위이며 신규 후보 인증/DB/API를 추가하지 않았다.
- service를 직접 실행해 HTTP 상태와 부작용을 검사했으나, 이번 명령에서 실제 Express 서버를 열어 HTTP 왕복을 수행하거나 실제 DB에 저장하지 않았다. router의 요청 시점 provider 연결은 소스로 확인했다.
- 캐시는 UPSTREAM_ERROR 때 이전 arrivals를 잠시 보존할 수 있다. 이를 최신 도착시간으로 안내하지 않는 문서·기존 음성 회귀는 확인했지만 신규 public cache-age/stale 필드나 별도 음성 정책을 검증한 것은 아니다.
- Kakao documents[0] 선택 정책 및 새 장소 재확인 API는 범위 밖이다. 외부 배포, 운영 DB, 환승 추적/BLE/새 DB 필드는 검증하거나 변경하지 않았다.

## 수정 파일과 결론

Tester가 작성한 파일은 **`.agent-loop/T4-testing.md` 하나**다. 앱/서버/공유 코드 및 시험 코드 수정, 커밋/푸시/배포/플래시/DB 변경 없음. T2 보고서는 앞 단계에서 완료한 상태로 유지했다.

**181/181과 세 프로젝트 타입 검사 PASS.** 재현된 T4 실패는 없으며 독립 Reviewer에게 넘길 수 있다. 이 결과는 로컬 회귀 통과이며 실제 기기 리허설 및 이후 전체 저장소 통합 검사와 구분한다.
