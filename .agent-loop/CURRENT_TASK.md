# Task 24: FIX-GBIS-ARRIVAL-DUPLICATE-ROUTEID

- 작업 식별자: `FIX-GBIS-ARRIVAL-DUPLICATE-ROUTEID`
- 관련 명세: 「공통 API 및 Function Calling 명세서」 **5.2-A**(도착 차량 정보). 계약 변경은 없다 — 계약대로 채워지지 않는 결함을 고친다.
- 현재 상태: **`READY`** (2026-08-12 선정, 착수 전)
- 현재 재시도 횟수: `0`
- 기준선: 서버 테스트 **128/128 pass**(2026-08-11 Task 23-A 시점 실측. 착수 시 재확인할 것)
- 운영 DB 쓰기: **없음.** 마이그레이션도 만들지 않는다.
- worktree: `C:/Users/yemoy/bta-gbis`(OneDrive 밖 짧은 경로, node_modules 설치됨). **`claude` 최신 SHA 기준으로 새 브랜치를 딴다.**

## 왜 이것을 다음 작업으로 골랐나

명세서상 남은 구현 항목은 없다. 이 결함은 PR #14 시절부터 "범위 밖·미착수"로 등록만 돼 있었으나,
**PR #20이 `arrivals`·`occupancy`를 출시하면서 그 기능을 직접 갉아먹는 위치가 됐다.**
승인 없이 착수 가능한 유일한 실질 코드 작업이기도 하다.

## 결함 (2026-08-12 fixture 실측으로 재확인)

`getArrivalInfo()`(`apps/server/src/adapters/routes/hyorin-route-search.adapter.ts:335`)가
`busArrivalList.find(a => String(a.routeId) === String(localBusId))`로 **첫 일치 항목**을 고른다.
그런데 GBIS 응답에는 같은 `routeId`가 두 번 나오고 **첫 항목이 빈 값인 경우가 실재한다.**

```text
routeId=233000281  idx3  predictTime1=""                    ← .find() 가 고르는 항목
                   idx4  predictTime1=15  predictTime2=88   ← 실제 도착정보
routeId=233000268  idx21 predictTime1=""                    ← .find() 가 고르는 항목
                   idx22 predictTime1=43
```

근거 파일: `apps/server/src/adapters/routes/__fixtures__/gbis-bus-arrival-list-station-233000575.json`
(24개 항목 중 중복 `routeId` 2쌍. 둘 다 `routeTypeCd=13`).

**증상**: GBIS가 도착정보를 주는데도 `arrivals: []`가 나가 사용자에게 "도착 정보 없음"으로 안내된다.
`occupancy`도 함께 사라진다. 502도 아니고 예외도 아니라서 **로그로는 드러나지 않는다.**

## 작업 범위

- `getArrivalInfo()`의 항목 선택 규칙만 고친다.
- **선택 규칙**: 같은 `routeId` 항목 중 **`predictTime1`이 유효한 항목을 고른다.**
  유효한 항목이 없으면 기존대로 첫 항목을 쓰고 결과는 `arrivals: []`로 지금과 같다.
- 이 규칙은 GBIS 필드 의미를 새로 추정하지 않는다 — "빈 항목보다 값 있는 항목"일 뿐이다.
  **Task 23-A에서 배운 실수(추정을 규칙으로 굳히기)를 반복하지 않기 위해 의도적으로 좁게 잡았다.**

## 수정 가능 파일

1. `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts` — `getArrivalInfo()`의 선택 로직
2. `apps/server/src/adapters/routes/hyorin-route-search.adapter.test.ts` — 아래 기존 테스트 갱신 + 회귀 테스트 추가

## 수정 금지 범위

- `OccupancySchema`·`ArrivalInfoSchema`·`CreateTripResponseSchema` 등 **계약 변경 금지.** 이번 건은 계약을 채우는 문제다.
- `toOccupancy()`의 `routeTypeCd` 분기(Task 23-A 결과)에 손대지 않는다.
- 좌석형 `crowded` fallback을 넣지 않는다 — **여전히 데이터가 부족하다**(아래 Task 23-A의 미해결 후속 참고).
- Supabase 마이그레이션·공개 API 신설·운영 DB 쓰기 금지.
- `search_routes` 응답 계약을 건드리지 않는다.

## 구현 완료 조건

1. `routeId=233000281` 조회 시 `arrivals`가 `predictTime` **15·88** 두 대를 반환한다(현재는 `[]`).
2. `routeId=233000268` 조회 시 첫 차량 **43**을 반환한다.
3. 중복이 없는 노선들의 기존 결과가 **하나도 바뀌지 않는다.**
4. 모든 후보 항목이 빈 값이면 기존대로 `arrivals: []`이고 운행 생성은 201로 성공한다.
5. `occupancy` 변환 결과는 선택된 항목 기준으로 따라 움직인다(별도 규칙 신설 없음).

## 테스트 조건

- TDD. **먼저 기존 테스트를 확인할 것** — Task 23-A가 현재(결함) 동작을 고정하는 테스트를 일부러 넣어 뒀다:
  `apps/server/src/adapters/routes/hyorin-route-search.adapter.test.ts:544`
  「같은 routeId 가 중복으로 오면 첫 항목만 보고 [] 를 반환한다 (선재 이슈, 미수정)」.
  **이번 수정으로 깨지는 것이 정상이며, 기댓값을 실제 도착 정보로 갱신한다**(테스트 주석에 그렇게 하라고 적혀 있다).
  같은 파일 `:501`의 다른 테스트는 이 두 `routeId`를 일부러 제외해 두었으니 함께 확인한다.
- 실제 캡처 fixture를 근거로 쓴다. 합성 케이스는 "모든 항목이 빈 값" 경로에만 쓴다.
- 기존 128개 중 위 고정 테스트를 제외한 나머지가 깨지지 않아야 한다.
- `node --import tsx --test $(find src -name '*.test.ts')` (apps/server), `pnpm -r typecheck`, 서버 build 통과.

## 참고

- 이 Task는 코드 작업만으로 닫힌다. 운영 검증·PR 병합은 사용자 몫이다.
- 착수 전 `git log origin/claude/nice-archimedes-iv7iu0 -1`로 최신 SHA를 다시 확인한다.

---

# Task 23-A: FIX-GBIS-OCCUPANCY-ROUTETYPE-GATING (Task 23 후속 정정, 같은 브랜치)

- 작업 식별자: `FIX-GBIS-OCCUPANCY-ROUTETYPE-GATING`
- 현재 상태: **`COMPLETE`** (2026-08-11). 커밋 `2953ad6`, push 완료. Reviewer `APPROVE`(결함 0건).
- worktree: `C:/Users/yemoy/bta-gbis` · 브랜치 `yemo/gbis-occupancy` (Task 23 커밋 `eb9dcc6` 위에 새 커밋 추가, amend 아님)
- 기준선: 123/123 → **128/128 pass**(합성 테스트 5개 추가). typecheck 3/3, build exit 0, 마이그레이션 0건.

## 결과 (Director 직접 재현 + Reviewer 독립 검증)

`toOccupancy`가 `routeTypeCd`로 먼저 분기하고 해당 필드 하나만 읽는다. 각 분기에서 유효값이 없으면
다른 필드로 흘러가지 않고 `UNAVAILABLE`로 닫힌다(Reviewer가 양방향 fall-through 차단을 실측 확인).

`readRemainingSeats` → `readSeatCount`, 유효 조건 `>= 1` → `>= 0`. 범위 검사라 `-1`뿐 아니라
모든 음수·비정수도 막혀 계약의 `nonnegative int`가 유지된다(Reviewer가 `-2`·`-99`·`2.5`로 확인).

**Reviewer가 16개 합성 케이스를 직접 주입해 검증했고, 전부 `OccupancySchema.safeParse` 통과. 계약 위반 누출 0건.**
기존 fixture 테스트의 숫자 기댓값은 하나도 안 바뀌었다(`git diff -U0`로 assertion 값 줄에 `-`가 0개임을 확인).

## ⚠️ 후속 확인 필요 — 좌석형 노선의 `crowded` 값 (미해결)

**공식 문서는 `crowded`가 `13`/`15`/`23`에만 제공된다고 하는데, fixture의 좌석형(11) 노선에 `crowded` 값이 실제로 채워져 있다.**

```
1006 (type 11): crowded1=0  seat1=70  || crowded2=1  seat2=23
1007 (type 11): crowded1=1  seat1=36  || crowded2=1  seat2=37
```

**이 값들이 좌석수와 모순되지 않는다** — `crowded=1`(여유)일 때 좌석이 23·36·37석 남아 있어 일관된다.
어제 시내버스에서 "여유(`crowded=1`)인데 0석"이라는 명백한 모순으로 노이즈를 판별했던 것과 상황이 다르다.
**즉 좌석형의 `crowded`가 진짜 값일 가능성을 배제할 수 없다.**

실질 영향: **좌석형 노선인데 `remainSeatCnt=-1`(정보없음)이고 `crowded`는 유효한 경우, 지금 구현은 `UNAVAILABLE`을 낸다.**
이전 구현은 `CONGESTION`을 냈다. `crowded`가 진짜 값이라면 안내 가능한 정보를 버리는 셈이다.

**지금 고치지 않은 이유**: 샘플이 2건뿐이고 `crowded` 값이 `0`·`1`만 관측됐다. 여기서 fallback을 넣으면
공식 문서에 반하는 추측 기반 로직이 되고, **이번 정정에서 배운 실수(추정을 규칙으로 굳히기)를 그대로 반복하는 것**이다.
fixture에 해당 조합(좌석형 + `seat=-1` + `crowded` 유효) 사례도 아직 없다.

**해소 조건**: 혼잡 시간대 재캡처로 (1) 좌석형이 만석일 때 `remainSeatCnt=0`을 정말 보내는지,
(2) 좌석형에서 `remainSeatCnt=-1`인데 `crowded`가 유효한 조합이 실제로 나오는지 확인한다. 효린에게 요청할 항목이다.

## 정정 사유

Task 23 구현 직후 GBIS 공식 매뉴얼(gbis.go.kr)을 확인했다. `crowded`·`remainSeatCnt`는
"한 버스가 둘 다 줄 수 있고 우선순위로 고른다"가 아니라 **노선유형(`routeTypeCd`)이 애초에
어느 필드가 유효한지 결정하는 구조**였다.

- `crowded1/2` 유효 노선유형: `13`(일반형시내)·`15`(따복형)·`23`(일반형농어촌)
- `remainSeatCnt1/2` 유효 노선유형: `11`·`12`·`14`(광역급행)·`16`(경기순환)·`17`(준공영제 직행좌석)·`21`·`22`
- `remainSeatCnt`의 공식 "정보없음"은 `-1`이다. **`0`은 유효값(만석)이다.**
- 그 외 노선유형(마을버스 `30` 등)은 두 필드 모두 대상이 아니다.

Task 23이 구현한 규칙("remainSeatCnt 값이 1 이상이면 유효, 0이면 무조건 정보없음")은
**노선유형을 안 보고 값만 봤다.** 시내버스(13)에선 결과적으로 맞았지만(그 노선유형은
애초에 이 필드 대상이 아니므로), **좌석형 노선(11/12/14/16/17/21/22)이 실제로 만석이 돼서
`remainSeatCnt=0`을 보내는 경우를 "정보없음"으로 잘못 접는다.** 이게 이번에 고칠 진짜 결함이다.

부수적으로, 1007번(직행좌석)의 `crowded=1`을 "혼잡도도 유효하다"고 보고 만든
"둘 다 유효하면 REMAINING_SEATS 우선" 규칙도 근거가 없어졌다 — 그 노선유형은 애초에
`crowded` 대상이 아니므로 `crowded=1`은 미사용 필드의 채움값(노이즈)일 가능성이 크다.

## 수정할 세 지점 (하나의 호출 체인)

1. `getArrivalInfo()` — `toArrival()` 호출 시 `matched.routeTypeCd`도 함께 전달
2. `toArrival()` — `routeTypeCd` 파라미터 추가, `toOccupancy()`로 전달
3. `toOccupancy()` — 실제 분기. `routeTypeCd`가 어느 집합에 속하는지 먼저 확인하고,
   해당하는 필드 **하나만** 읽는다. 다른 필드는 값과 무관하게 무시한다.

## 완료 조건

- `readRemainingSeats`가 좌석형 노선에서 `0`을 유효값(만석)으로 반환한다(합성 테스트로 증명, 실제 GBIS 캡처엔 아직 이 사례가 없다).
- 시내버스형 노선은 `remainSeatCnt` 값이 뭐든(`0`이든 다른 값이든) 무시하고 `crowded`만 본다.
- 좌석형 노선은 `crowded` 값이 뭐든 무시하고 `remainSeatCnt`만 본다.
- 어느 집합에도 속하지 않는 노선유형은 `UNAVAILABLE`.
- 기존 fixture 기반 테스트의 **기댓값은 그대로 유지**되어야 한다(실측 데이터 자체는 안 바뀌었으므로 — 확인해보면 각 fixture 노선이 이미 올바른 하나의 필드에서만 실제값을 주고 있어서, 결과 숫자는 안 바뀐다. 근거만 "값 기반 추정"에서 "노선유형 기반 확정"으로 바뀐다).
- `OccupancySchema`의 JSDoc(직전 라운드에 추가한 "GBIS 어댑터는 0을 절대 내보내지 않는다") 문구를 정정한다 — 이제는 좌석형 노선에서 0을 낼 수 있다.
- 기존 123개 테스트가 깨지지 않는다(단, 근거가 바뀐 테스트의 주석·설명은 갱신).

---

# Task 23: IMPLEMENT-GBIS-OCCUPANCY

- 작업 식별자: `IMPLEMENT-GBIS-OCCUPANCY`
- 관련 명세: 「공통 API 및 Function Calling 명세서」 **5.2-A**(도착 차량 정보 확장)
- 현재 상태: **`COMPLETE`** (2026-08-11). 커밋 `eb9dcc6`, `origin/yemo/gbis-occupancy` push 완료. **PR 생성·병합은 사용자 몫이다.**
- 현재 재시도 횟수: `0` (Implementer 1회 + Director 지시 후속 수정 1회, Reviewer `APPROVE`)

## 최종 결과 (Director 직접 재현 검증)

| 항목 | 결과 |
| --- | --- |
| 서버 테스트 | **123/123 pass, 0 fail** (기준선 108 → 신규 15. 기존 108개 전부 유지) |
| `pnpm -r typecheck` | shared·server·mobile **3/3 Done** |
| 서버 build | `tsc` **exit 0** |
| 마이그레이션 | **0건** (`git status --short supabase/` 비어 있음) |
| Reviewer 판정 | **APPROVE** — 치명 0, 중대 0, 경미 2(둘 다 처리 또는 근거 있는 보류) |

변경 10개 파일: `trip.schema.ts`, `latest-contract.typecheck.ts`, `hyorin-route-search.adapter.ts`(+test), `create-trip.service.ts`(+test), `trips.ts`, `guide.ts`(server), `guide.ts`(mobile), `bell-demo.ts`.

**Reviewer 제안 중 채택하지 않은 것 1건.** `remainingSeats`를 `.nonnegative()` → `.positive()`로 좁히자는 제안. 계약 5.2-A가 `remainingSeats: 0`을 "만석"이라는 **유효값**으로 정의하므로 좁히면 계약 위반이다. 지금 `0`이 안 나가는 것은 GBIS 원본에서 만석과 미보고를 구분할 수 없어 어댑터가 안전하게 접기 때문이지 계약이 금지해서가 아니다. 대신 이 배경을 스키마 주석에 남겨 나중에 누가 가드를 풀지 않도록 했다.

**알려진 한계(의도적)**: 실제로 만석인 좌석제 버스를 "만석"으로 안내하지 못한다. 접근성 앱에서 틀린 만석 안내가 정보 누락보다 나쁘다고 판단해 안전한 쪽으로 접었다.

**남은 후속**(전부 handoff에 등록): `docs/` 서술형 문서 4개의 구식 표현(10-A절), `.find()` 중복 `routeId` 선재 이슈(현재 동작을 고정하는 테스트로 명시해 둠), `congestionLevel` 2·3·4 실물 미관측.
- 운영 DB 쓰기: **없음.** 마이그레이션도 만들지 않는다(아래 "수정 금지 범위" 참고).
- worktree: `C:/Users/yemoy/bta-gbis` · 브랜치 `yemo/gbis-occupancy` (base `8afa03b` = origin/claude/nice-archimedes-iv7iu0)
- 기준선: 서버 테스트 **108/108 pass** (2026-08-11 착수 시점 실측)

## 작업 목적

명세 5.2-A가 2026-08-11에 완전히 확정됐다(마지막 미결이던 라벨 여부 + GBIS 원본 매핑 규칙 둘 다 해소).
`create_trip` 응답의 도착 정보를 단일 `predictedArrivalMinutes`에서 **최대 2대 배열 `arrivals`**로 바꾸고,
각 차량에 혼잡도·잔여좌석(`occupancy`)을 붙인다.

**핵심은 GBIS 원본 값을 그대로 흘려보내지 않는 것이다.** 원본 sentinel(`""`/`0`/`-1`)을 계약 값으로
번역하지 않으면 여유로운 시내버스가 "만석"으로 안내된다(2026-08-11 실측으로 확인된 위험).

## 확정된 계약 (5.2-A)

```json
"arrivals": [
  { "predictedArrivalMinutes": 6,  "occupancy": { "type": "CONGESTION",      "congestionLevel": 3,    "remainingSeats": null } },
  { "predictedArrivalMinutes": 21, "occupancy": { "type": "REMAINING_SEATS", "congestionLevel": null, "remainingSeats": 4 } }
]
```

- `arrivals`는 도착 순서대로 **최대 2개**. GBIS가 1대만 주면 1개, 정보 없으면 빈 배열 `[]`.
- `occupancy.type` = `CONGESTION | REMAINING_SEATS | UNAVAILABLE`
  - `CONGESTION`: `congestionLevel` 1~4, `remainingSeats` = `null`
  - `REMAINING_SEATS`: `congestionLevel` = `null`, `remainingSeats` 0 이상 정수 (**출력값 0 = 만석, 유효값**)
  - `UNAVAILABLE`: 둘 다 `null`
- GBIS 호출 실패·timeout 시 운행 생성은 그대로 진행하고 `arrivals: []`.

### GBIS 원본 → 계약 변환 규칙 (2026-08-11 확정, 실측 근거)

| 원본 필드 | 값 | 해석 |
| --- | --- | --- |
| `crowded1/2` | `""` 또는 `0` | 혼잡도 정보 없음 |
| `crowded1/2` | `1~4` | `congestionLevel` 유효값 |
| `remainSeatCnt1/2` | `""` 또는 `-1` | 좌석 정보 없음 |
| `remainSeatCnt1/2` | `0` | **혼잡도를 보고하는 차종에서는 미보고 기본값 → 정보 없음.** 만석으로 읽지 않는다 |
| `predictTime1/2` | `""` | 해당 차량 없음 → 배열에 넣지 않는다 |

- 둘 다 정보 없음 → `UNAVAILABLE`
- **둘 다 유효 → `REMAINING_SEATS` 우선** (직행좌석형에서 실제 관측됨: 1007 = `crowded=1` + `remainSeat=36`)

> 실측 근거(2026-08-06 20:24 캡처, 24개 노선): `routeTypeCd` 13 9건 전부 `crowded=1`+`remainSeat=0`,
> 30 3건 전부 `crowded=0`+`remainSeat=-1`, 11 2건은 좌석수 실값(70/36).
> **미확인**: `congestionLevel` 2·3·4는 실물 미관측(당시 전 노선 여유).

## 수정 가능 파일

1. `packages/shared/src/schemas/trip.schema.ts` — `OccupancySchema`·`ArrivalInfoSchema` 신설, `CreateTripResponseSchema`의 `predictedArrivalMinutes` → `arrivals`
2. `packages/shared/src/schemas/latest-contract.typecheck.ts` — 예시 갱신
3. `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts` — `getArrivalInfo()`가 최대 2대 + `occupancy` 반환, sentinel 매핑, **5초 timeout 추가**
4. `apps/server/src/services/trip/create-trip.service.ts` — `arrivals` 배열 처리
5. `apps/server/src/routes/trips.ts` — 배선 변경
6. `apps/server/src/services/guide.ts` — `generateTripStartGuide`가 `arrivals[0]` 기준
7. `apps/mobile/src/realtime/guide.ts` — 안내 규칙 문구를 `arrivals` 기준으로
8. 위 파일들의 `*.test.ts`

## 수정 금지 범위

- **Supabase 마이그레이션을 만들지 않는다.** 운영 DB 스키마 변경은 사용자 승인 범위 밖이다(DIRECTOR.md 중단 조건 7).
  기존 `trips.predicted_arrival_minutes` 컬럼은 그대로 두고 **첫 번째 차량의 도착 시간만** 계속 저장한다.
  `occupancy`는 응답 전용이며 저장하지 않는다(도착 정보는 몇 분이면 무효해지는 휘발성 데이터라 저장 가치가 낮다).
- 공개 API 신설 금지. 경로·엔드포인트를 추가하지 않는다.
- `search_routes`(`POST /api/routes/search`) 응답 계약은 건드리지 않는다. 이번 변경은 `create_trip` 전용이다.
- 다른 미결 작업(Realtime smoke, outbound IP 관측)에 손대지 않는다.

## 구현 완료 조건

1. `getArrivalInfo()`가 GBIS 응답에서 최대 2대를 순서대로 뽑고 각 차량의 `occupancy`를 위 규칙대로 변환한다.
2. 시내버스 `remainSeatCnt=0`이 `remainingSeats: 0`(만석)으로 새지 않는다. **이 회귀 테스트가 반드시 있어야 한다.**
3. 둘 다 유효한 경우 `REMAINING_SEATS`가 선택된다.
4. GBIS 실패·timeout·차량 없음이면 `arrivals: []`이고 운행 생성은 201로 성공한다.
5. `CreateTripResponseSchema`가 `arrivals`를 강제하고 `predictedArrivalMinutes`는 응답에서 사라진다.
6. DB에는 첫 차량 도착 시간만 기존 컬럼에 저장된다(마이그레이션 0건).

## 테스트 조건

- TDD. 실패하는 테스트를 먼저 작성해 기대한 assertion으로 실패하는 것을 확인한 뒤 구현한다.
- 실제 캡처 fixture(`apps/server/src/adapters/routes/__fixtures__/gbis-bus-arrival-list-station-233000575.json`)를 근거로 쓴다.
  이 파일에 시내버스(`crowded=1`+`remainSeat=0`)·마을버스(`0`/`-1`)·직행좌석(둘 다 유효) 세 케이스가 전부 들어 있다.
- 기존 108개가 하나도 깨지지 않아야 한다.
- `node --import tsx --test $(find src -name '*.test.ts')` (apps/server 기준), `pnpm -r typecheck`, 서버 build 통과.

## 참고

- 이번 Task는 코드 작업만으로 닫힌다. 운영 검증·PR 병합은 사용자 몫이다.
- Task 22(운영 E2E)는 2026-08-11 완료됐다. 상세는 handoff 0절.
