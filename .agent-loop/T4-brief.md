# T4 환승 검색 통합 및 조회 회귀 인계

계획 T4 / 공통 제약. T3 이후 실행한다. 최신 57e50ea + 이번 T2 변경 위에 원본 로컬 커밋 ebb5bdd의 검색·안내만 이식한다. 원본 작업 폴더는 읽기만 한다.

## 가져올 것과 보존할 것

`git show --stat ebb5bdd`의 16개 파일을 확인하고, 특히 그 커밋의 설계 문서 `docs/superpowers/specs/2026-09-03-multimodal-route-design.md`를 읽는다. commit 전체 cherry-pick 또는 파일 전체 덮어쓰기는 금지. 최신 방향 판정·외부 오류 위생·노선 발음 routeNoSpoken·T2 빈 인자/후보 진단을 보존한다.

- 기본 DIRECT_BUS. ROUTE_SEARCH_SCOPE=MULTIMODAL에서만 버스 환승/버스+지하철 검색·안내. 지하철만 있는 경로 제외.
- routeMode DIRECT_BUS|MULTIMODAL, segments WALK/BUS/SUBWAY 등 공개 문자열. ODsay 내부 숫자 pathType/trafficType가 API·DB·trip 요청으로 새지 않는다.
- 환승 후보 tripSupported=false. RouteList 화면의 실제 선택과 Realtime create_trip 모두 차단. 서버 직접 create_trip 조작도 stationList/후보 계약에서 차단되는지 확인.
- 전체 환승 경로를 한 직행 stationList로 꾸며 운행 생성하지 않는다. 환승 추적/BLE/DB 새 필드 추가 금지.
- 원본의 사용자 미커밋 `apps/server/src/routes/route-search-provider.ts`, 그 test 및 routes.ts 연결을 읽어서 WT에 필요한 부분을 이식한다. ROUTE_SEARCH_MODE=MOCK는 위 SCOPE와 다른 설정이며 요청 시점 환경을 읽어 dotenv import 순서 문제를 방지한다. 기존 mock adapter는 유지한다. README/.env.example/API_SPEC/MODULE_CONTRACTS와 필요한 현재 설계 문서 동기화.

추가 사전 확인: 원래 ebb5bdd는 모든 버스 구간 stationList를 이어 붙이므로 해당 숫자·이름만 보고 운행을 지원한다고 취급하면 안 된다. 최신 create-trip.service는 요청의 stationList를 검증하지만 서버 후보 저장소와 대조하지 않는다(문서의 과거 설명과 차이). 따라서 클라이언트 두 경로 차단을 반드시 실제 시험하고, 서버에 명시적으로 전달된 `tripSupported:false`/`routeMode:MULTIMODAL` 또는 기존 `busTransitCount>1`이 저장되지 않도록 기존 INVALID_REQUEST 범위의 방어를 검토한다. provenance를 모두 제거한 임의 직행 모양 요청까지 검색 이력과 대조했다고 주장하지 말 것. 새 세션/후보 인증 API는 합의 밖이므로 만들지 않는다. 이 한계를 결과·API 문서에 정직하게 기록한다.

음성의 전체 구간 안내도 확인한다. 모바일 guide.ts의 기존 버스 전용 역할은 지하철 단독 추천 금지와 혼합 후보의 안내 전용 설명을 양립시켜야 한다. `segments`와 `tripSupported:false`를 Realtime에 전달하고 검색·안내만 가능함을 사용자에게 알려 선택/운행 성공을 암시하지 않는다. T2 작업 종료 뒤 해당 guide.ts를 포함해 필요한 최소 문구를 수정할 수 있다.

## 도착 캐시 PR44의 누락 시험

`origin/audit-pr44`는 많은 옛 코드를 포함한다. 파일 전체 이식 금지. `git diff 57e50ea origin/audit-pr44 -- apps/server/src/services/arrival/arrival-cache.test.ts`의 뒤쪽 시나리오만 현재 정책에 맞춰 추가한다.

기존 목적지별 캐시 분리·로그 위생·30초 임박 정책 시험을 보존한다. 반복 refresh 최소 간격, 처음부터 실패, 성공 뒤 지속 실패, throw 경로, stale 값 폐기 뒤 lastAttemptAt 하한 유지가 중요하다. 구현에 lastAttemptAt가 이미 있으므로 새 시험이 통과하면 불필요한 코드 수정 없음.

## 방향 예외

같은 adapter 파일의 stationMatches는 이름 같으면 true, 이름 다르면 100m 미만 거리만 허용한다. resolveDirectionalStaOrder는 모든 목적지 occurrence마다 가장 가까운 앞선 boarding occurrence를 모아 한 방향만 허용한다. 기존 private helper export를 시험만 위해 무리하게 늘리기보다 mocked axios로 getArrivalInfo 실제 소비 경로를 검증한다.

이름 불일치 100m 바로 안/밖 경계, 목적지 세 번 등장 후 동일 방향/서로 다른 방향, 순환 구간에서 목적지가 탑승 뒤에 없는 경우 안전한 오류 처리. 실제 GBIS 표본과 synthetic fixture 구분. 기존 haversineKm은 유지.

Kakao documents[0] 선택 문제(A09)는 PENDING_DECISIONS 최신 표에 계약 대기로 기록됐다. 새 장소 재확인 공개 API를 임의로 만들지 않는다. 원시 목적지 텍스트가 오류 로그로 유출되는 새 경로는 만들지 않는다.

검증: 관련 adapter/guide/route-create/mobile-guard/cache/provider tests + typecheck. 로그 `.agent-loop/T4-*.log`, 보고 `.agent-loop/T4-implementation.md`. commit/push/외부 API 실제 호출/운영 DB 변경 없음.
