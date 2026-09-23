# T4 구현 인계

- 작성: 2026-09-23 KST. 구현자 `local_docs_audit`.
- WT: `C:\Users\yemoy\OneDrive\문서\한이음\.worktrees\rehearsal-20260922`.
- 상태: 구현 및 아래 로컬 검사 완료. 독립 Tester → Reviewer 대기.
- 원본 checkout은 읽기만 했고 commit/push/deploy/외부 API 실제 호출/운영 DB 변경은 하지 않았다.
- phase A는 server/shared/docs만 수정했다. Director가 T2 소스 대조 완료 후 모바일 3파일 편집을 허용한 뒤 phase B를 진행했다. T2의 Provider/session/BLE/tracking/Alight 및 T3 파일은 수정하지 않았다.

## 구현

1. `ebb5bdd`의 설계와 코드 차이를 읽고 검색·구간 정규화만 현재 adapter에 선별 반영했다. 기존 GBIS 방향 판정, 조회 진단, 실패 로그, API timeout은 보존했다. 커밋 전체나 기존 파일 전체를 덮어쓰지 않았다.
2. 기본 `DIRECT_BUS`, 명시적 `ROUTE_SEARCH_SCOPE=MULTIMODAL`에서만 버스 환승/버스+지하철 후보를 반환한다. 지하철 단독 제외. 공개 값은 `routeMode`, `tripSupported`, `segments[].mode=WALK|BUS|SUBWAY`이며 ODsay 숫자 enum은 반환하지 않는다.
3. 환승은 `tripSupported=false`. 모든 버스 정류장 목록을 합치던 원본 커밋 방식은 채택하지 않았다. 호환용 최상위 식별자·정류장·stationList는 **첫 버스 구간**, 전체 이동 순서와 최종 도착 구간은 **segments**다. 버스가 먼저 나오고 지하철로 목적지에 도착하는 경로를 첫 버스 하차점의 700m 거리 조건으로 잘못 버리지 않는다. 버스 구간별 기본 식별자/정류장 좌표를 검사한다.
4. 기존 직행 점수/노선 번호 중복 제거/후보 5개·안내 2개 정책 유지. 다중교통 중복은 전체 segments 기준으로 분리하므로 같은 버스에 서로 다른 지하철이 붙은 후보를 잘못 합치지 않는다.
5. 다중교통 반환 guideMessage는 서버가 모든 구간을 순서대로 조합한다. 모델이 버스만 언급해도 도보·지하철·최종 도착점은 누락되지 않는다. 안내 전용/하차벨 미지원 문구를 붙이고 모델의 부분 문장을 다시 붙여 중복하지 않는다. 버스 구간 발음에는 기존 `toSpokenRouteNo`를 사용한다.
6. 서버 생성 방어는 기존 CreateTripRequestSchema에 적용했다. `tripSupported:false`, `routeMode:MULTIMODAL`, `busTransitCount>1`은 `400 INVALID_REQUEST`, 도착정보 조회/저장 부작용 0건. 직행의 새 필드 생략은 허용한다. 신규 DB 필드/마이그레이션 없음.
7. 원본 checkout의 사용자 미커밋 provider/test를 읽어 요청 시점 `ROUTE_SEARCH_MODE=MOCK` 선택을 반영했다. MODE와 SCOPE는 별개다. 기존 mock adapter는 보존하며 직행 metadata를 채운다. router가 요청마다 provider를 선택한다.
8. `RouteListScreen`은 안내 전용 카드에 전체 segments를 표시한다. disabled 속성뿐 아니라 실제 selectRoute 콜백도 초기에 차단하여 API/BLE/선택 상태/화면 이동 부작용이 없다. 기존 직행 선택의 scan stop→API→Riding 동작은 보존한다.
9. Realtime Dispatcher는 모델이 전달한 metadata가 아닌 **앱에 보관된 선택 후보**의 routeMode/tripSupported/busTransitCount로 차단한다. 모델용 결과에 기존 routeNoSpoken 및 버스 구간 routeNumbersSpoken을 제공하며 검색·다음 후보·취소 후 후보 모두 전체 segments 안내를 지시한다. 실패한 create_trip을 선택 성공으로 안내하지 않도록 한다. T2 빈 인자 가드·후보 진단·stale guard 등은 유지했다.
10. 모바일 전역 guide/tool 설명은 반환된 혼합 후보 안내를 허용하면서 지하철 단독 추천/환승 운행 시작을 금지한다. 선택 질문은 지원되는 직행 후보에만 한다.
11. PR44에서 추가 refresh 시험만 이식했다. cache 구현 및 기존 목적지별 분리/로그 위생/30초 임박 정책은 변경하지 않았다. 방향 시험도 현행 adapter의 근사거리 distanceKm을 그대로 시험했다. haversine 일괄 교체 없음.
12. Kakao 목적지 없음 오류에서 원시 목적지 텍스트를 제거했다. documents[0] 장소 선택 정책/API는 변경하지 않았다.

## 정확한 T4 수정 파일

기존 tracked 파일:

- `.env.example`
- `README.md`
- `apps/mobile/src/realtime/function-dispatcher.ts`
- `apps/mobile/src/realtime/guide.ts`
- `apps/mobile/src/screens/RouteListScreen.js`
- `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts`
- `apps/server/src/adapters/routes/mock-route-search.adapter.ts`
- `apps/server/src/routes/routes.ts`
- `apps/server/src/services/arrival/arrival-cache.test.ts`
- `apps/server/src/services/guide.ts`
- `apps/server/src/services/trip/create-trip.service.test.ts`
- `packages/shared/src/schemas/route.schema.ts`
- `packages/shared/src/schemas/trip.schema.ts`
- `packages/shared/src/types/route.ts`
- `docs/API_SPEC.md`
- `docs/MODULE_CONTRACTS.md`

새 코드/시험 파일:

- `apps/server/src/adapters/routes/multimodal-route.test.ts`
- `apps/server/src/adapters/routes/arrival-direction-boundaries.test.ts`
- `apps/server/src/services/multimodal-guide.test.ts`
- `apps/server/src/routes/route-search-provider.ts`
- `apps/server/src/routes/route-search-provider.test.ts`
- `apps/server/src/integration/mobile-multimodal-route.test.ts`

문서에는 기본 설정, 안내 전용 범위, 첫 버스 호환 필드와 전체 segments 구분, 서버 provenance 한계, UPSTREAM_ERROR에서 이전 arrivals를 최신값으로 안내하지 않는 규칙을 반영했다. README/API/MODULE은 T6와 공유하므로 T4 관련 문단만 추가·정정했다.

## 실제 검증과 재현 명령

환경: Windows / Node v24 / 설치된 tsx·TypeScript. tsx shim 문제 때문에 실제 CLI 파일을 Node로 실행했다. esbuild child process는 기본 sandbox의 EPERM으로 인해 허용된 로컬 실행 승격을 사용했다. 외부 API는 axios/fetch/OpenAI 메서드 stub으로 대체했다.

WT의 `apps/server`에서:

```powershell
node node_modules/tsx/dist/cli.mjs --test src/adapters/routes/hyorin-route-search.adapter.test.ts src/adapters/routes/multimodal-route.test.ts src/adapters/routes/arrival-direction-boundaries.test.ts src/services/guide.test.ts src/services/multimodal-guide.test.ts src/services/trip/create-trip.service.test.ts src/services/route/search-routes.service.test.ts src/routes/route-search-provider.test.ts src/services/arrival/arrival-cache.test.ts src/integration/route-number-speech.test.ts src/integration/mobile-function-dispatcher.test.ts src/integration/mobile-multimodal-route.test.ts
```

- **181/181 PASS**, `.agent-loop/T4-tests.log`.
- 그 이후 시험의 optional response.instructions 존재 단언만 보강했다. 해당 파일 **10/10 PASS**, `.agent-loop/T4-mobile-final.log`.
- phase A **146/146 PASS**, `.agent-loop/T4-phase-a-tests.log`.
- phase B 모바일/기존 Dispatcher/발음 **43/43 PASS**, `.agent-loop/T4-mobile-tests.log`.

WT 루트에서:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p packages/shared/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
git -c core.safecrlf=false diff --check
```

- 세 프로젝트 typecheck 모두 exit 0, `.agent-loop/T4-{shared,server,mobile}-typecheck.log`.
- `git diff --check` exit 0, `.agent-loop/T4-diff-check.log`. Git의 LF→CRLF 알림만 있음.
- 최초 server tsc는 새 시험 코드의 optional response 필드 6개 진단을 냈고 수정 후 **server 전체**를 다시 실행해 exit 0을 확인했다. T2의 앞선 로그에 남아 있는 해당 오류는 현재 해결됐다.

RED 증거:

- `.agent-loop/T4-red.log`: 구현 전 환승 검색/서버 차단 실패. 명시적 환승 요청이 201이던 문제 재현.
- `.agent-loop/T4-progress.log`: 구간 안내/혼합 후보 중복 제거 3개 실패 후 보완.
- `.agent-loop/T4-mobile-red.log`: 실제 화면·음성·안내 9개 실패, 기존 직행 1개 PASS. 실제 callback 실행 후 GREEN.
- `.agent-loop/T4-guide-omission-red.log`: 모델이 버스만 반환하면 지하철·도보를 빼던 문제를 반환 guideMessage 단언으로 재현 후 GREEN.

## 검증 범위와 남은 확인

- 방향 경계 시험은 synthetic GBIS 응답으로 다른 이름 99.9m/100.1m, 동일 이름, 목적지 3회 등장 동일/다른 방향, 목적지가 탑승 이전에만 있는 순환 구간을 실제 getArrivalInfo 소비 경로로 검사했다. 기존 캡처 fixture 회귀도 통과했으나 신규 실시간 GBIS 표본 수집은 아니다.
- cache 추가 시험은 반복 refresh, 최초 조회 실패, 성공 뒤 연속 실패, throw, stale 배열 폐기 뒤 lastAttemptAt 제한을 확인한다. 방향/캐시 운영 코드 변경 없음.
- 화면 시험은 실제 RouteList 소스를 JSX 변환해 renderItem/onPress를 실행하고 RN·API·BLE 경계만 대체했다. Android 기기 렌더·TalkBack·실제 음성 인식/발음·ODsay/GBIS 실시간 호출·BLE 실물 E2E는 미실행이다.
- 서버에는 검색 후보 인증 저장소가 없다. 환승 metadata를 모두 삭제한 직행 모양 요청을 검색 이력과 대조했다고 주장할 수 없다. 이번 방어는 명시적 지원 불가 marker와 기존 stationList 계약 검사이며, 별도 후보 인증 API는 만들지 않았다.
- 새 route metadata는 기존 직행 타입 사용자를 위해 공유 스키마에서 optional이다. 현재 검색 adapter/mock은 채워 반환한다.
- API 문서의 stale 설명을 실제 구현에 맞췄다. UPSTREAM_ERROR + 보존된 arrivals가 공개될 수 있으나 최신 도착시간으로 안내하지 않는다. cache age/public stale 필드·별도 stale 음성 정책은 추가하지 않았다.
- 최신 전체 저장소 시험은 독립 Tester가 다른 T2 병렬 수정 freeze 후 수행할 수 있다. 이 인계는 위 관련 181개와 세 전체 typecheck 결과를 보고하며, 실행하지 않은 전체 시험/배포 성공을 주장하지 않는다.

이 시점부터 구현자 편집 종료. 독립 Tester/Reviewer가 이 파일 목록과 `.agent-loop/T4-*.log`를 대조하면 된다.
