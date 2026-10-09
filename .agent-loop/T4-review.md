# T4 독립 검토 (2026-09-23)

## 판정

- **명세: APPROVE** — 사용자가 최종 확정한 “오래된 Notion 명세보다 최근에 제시한 방향과 최신 코드 기준”에 따라, 기본 `DIRECT_BUS`를 보존하고 명시적 `ROUTE_SEARCH_SCOPE=MULTIMODAL`에서만 안내 전용 환승 후보를 추가하는 T4 범위를 승인한다.
- **코드 품질: APPROVE** — 공개/내부 계약 경계, 결정적 전체 구간 안내, 세 소비 경로의 운행 생성 차단, 기존 직행·MOCK·캐시·방향 판정 및 T2 공존을 검토했으며 새 중대 결함을 찾지 못했다.
- 실제 ODsay/GBIS 호출, Android 화면·음성·BLE 실물 흐름 및 운영 배포는 이 판정의 증거가 아니다.

## 계약 충돌 기록

[Notion 한이음 프로젝트](https://app.notion.com/p/3adff779d69181aab9c8e9bcd717ca8c)의 기존 `백엔드 개발 명세서` 단계 4와 `공통 API 및 Function Calling 명세서` 5.1은 직행버스 후보만 반환하고 반환 후보를 `create_trip`에 사용할 수 있는 구조로 기술한다. T4의 `MULTIMODAL`, `routeMode`, `tripSupported`, `segments` 및 안내 전용 후보는 그 오래된 문구와 일치하지 않는다. 다만 사용자가 이번 작업에서 최근 방향과 최신 코드를 기준으로 삼으라고 명시해 AGENTS 우선순위 1이 적용되므로 이 충돌을 blocker로 판정하지 않았다. 향후 Notion 동기화 시에는 해당 두 문서의 검색·후보 계약을 최신 결정에 맞춰 갱신해야 한다.

## 핵심 확인

1. **검색 범위와 공개 계약:** `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts:119-122`는 미설정/다른 값에서 `DIRECT_BUS`, 정확한 `MULTIMODAL` 값에서만 확장한다. `:214-221`은 기본 범위에서 단일 직행 버스만 남기고 확장 범위에서도 버스 없는 지하철 단독 경로를 제외한다. `packages/shared/src/schemas/route.schema.ts:3-13,47-52`의 공개 구간은 `WALK | BUS | SUBWAY` 문자열과 이름·노선·시간만 담는다. ODsay `pathType`·`trafficType` 숫자는 어댑터 분기에만 사용되고 반환 객체에는 복사되지 않는다.
2. **첫 버스 호환 필드와 전체 여정:** 어댑터 `:225-241`은 최상위 정류장과 `stationList`를 첫 버스 구간에서만 만들고, `:257-314`는 전체 subPath 순서를 `segments`에 보존한다. 환승 후보는 `routeMode=MULTIMODAL`, `tripSupported=false`이며 여러 버스 정류장 목록을 하나의 추적 경로로 합치지 않는다. 버스 뒤 지하철로 도착하는 후보에는 첫 버스 하차점의 목적지 700m 조건을 적용하지 않는다(`:247-255`).
3. **결정적 안내:** `apps/server/src/services/guide.ts:180-206,232-240`은 MULTIMODAL에서 모델 문장 대신 모든 segments를 순서대로 조합한 안내와 미지원 고지를 반환한다. 따라서 모델이 일부 구간을 빼도 공개 `guideMessage`는 도보·버스·지하철·최종 도착 구간을 잃지 않는다. 모바일 Dispatcher는 각 버스 구간에 모델 전용 `routeNumbersSpoken`을 붙인다(`apps/mobile/src/realtime/function-dispatcher.ts:225-249`).
4. **운행 생성 차단:** 실제 RouteList 콜백은 `tripSupported=false`, `routeMode=MULTIMODAL`, `busTransitCount>1`을 API·BLE·상태 변경 전에 반환한다(`apps/mobile/src/screens/RouteListScreen.js:23-25,67-70`). Realtime은 모델 인자를 신뢰하지 않고 앱에 저장된 candidateId 후보를 다시 찾은 뒤 같은 세 표식을 검사한다(`apps/mobile/src/realtime/function-dispatcher.ts:506-527`). 서버의 `CreateTripRequestSchema`는 `routeMode=DIRECT_BUS`, `tripSupported=true`, `busTransitCount<=1`만 허용하므로 명시적 미지원 요청은 도착정보 조회·저장 전에 `400 INVALID_REQUEST`가 된다(`packages/shared/src/schemas/trip.schema.ts:42-44`).
5. **provenance 한계:** 서버는 저장된 검색 후보와 `POST /api/trips` 요청을 대조하지 않는다. 공격자나 임의 호출자가 환승 metadata를 모두 제거하고 일관된 직행 모양 요청을 만들면 이번 방어만으로 원본 후보를 증명할 수 없다. 이 한계와 후보 인증 API가 범위 밖이라는 사실을 `docs/API_SPEC.md:168` 및 `docs/MODULE_CONTRACTS.md:24`에 정확히 기록했다.
6. **기존 동작 보존:** `ROUTE_SEARCH_MODE=MOCK` 선택은 요청 시점에 별도로 평가되고 SCOPE와 독립적이며 mock은 직행 metadata를 반환한다. 기본 직행은 기존 lane별 후보와 노선번호 중복 정책을 유지한다. 방향 판정은 같은 이름 또는 이름 불일치 시 100m 미만, 모든 목적지 occurrence가 한 방향으로 수렴할 때만 허용한다. 도착 캐시는 운영 코드를 바꾸지 않고 refresh 최소 간격, 지속 실패·throw, stale 폐기 뒤 `lastAttemptAt` 보존을 회귀 시험으로 고정했다.
7. **T2 공존:** T4 모바일 편집은 Dispatcher·guide·RouteList에 한정했고 Provider/session/BLE/tracking/Alight 수명주기를 변경하지 않았다. T2의 빈 인자 허용 목록, 후보 TTL·실제 출력 완료 표시, stale 운행 상태 차단과 최신 노선 발음 로직도 유지된다.

## 검증 범위

- 독립 Tester가 관련 시험 **181/181 PASS**, shared/server/mobile 타입 검사 각각 exit 0, tracked diff 공백 검사 exit 0을 직접 확인했다. Reviewer는 동일 전체 시험을 반복 실행하지 않고 최종 소스·시험·보고를 대조했다.
- 방향 경계는 synthetic GBIS 99.9m/100.1m 및 반복 정류장 fixture이고 실시간 표본이 아니다. 화면 시험은 실제 JSX와 callback을 실행하지만 RN·API·BLE는 대체 I/O다.
- Notion API 5.2-A의 최대 2대 arrivals·occupancy는 최신 공유 스키마와 서버 경로에 이미 구현된 별도 기존 범위이며 T4 판정에 섞지 않았다.

Reviewer가 수정한 파일은 이 리뷰 문서 하나다. 앱·서버·공유 코드, 시험 및 Git 인덱스는 변경하지 않았다.
