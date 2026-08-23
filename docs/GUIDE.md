# guide.ts — AI 안내 문장 생성 모듈

## 역할
시각장애인 버스 승하차 보조 앱(BUS-TA)의 AI 안내 문장 생성 담당 모듈이다.
예모 백엔드는 TypeScript/ESM 기준으로 `import { generateRouteGuide } from "../guide.js"`처럼 import하여 호출한다.

## 파일
- `apps/server/src/services/guide.ts` — 안내 문장 생성 함수 모음

## 함수 목록

| 함수명 | 역할 | OpenAI 사용 |
|---|---|---|
| selectRouteCandidates | 노선 후보 최대 2개 선택 | X |
| generateRouteGuide | 선택된 후보의 안내 문장 생성 | O, 키 없으면 fallback |
| generateTripStartGuide | 탑승 대기 안내 문장 생성 | O, 키 없으면 fallback |
| generateMovingGuide | 이동 중 안내 문장 생성 | O, 키 없으면 fallback |
| generateErrorGuide | 오류 fallback 문장 반환 | X |

## 노선 후보 선택 기준

후보 선택은 `selectRouteCandidates`가 서버에서 결정한다. OpenAI는 선택에 관여하지 않고
선택된 후보의 안내 문장만 생성하므로, 같은 입력이면 항상 같은 후보가 나온다.

정렬 기준은 다음 순서다.

1. 예상 총 소요시간 = `totalTime + intervalTime / 2` 가 짧은 순
   - 버스가 균등한 간격으로 온다고 가정하면 평균 대기시간이 배차간격의 절반이므로,
     이동시간과 배차간격을 따로 비교하지 않고 하나의 값으로 합쳐서 비교한다.
   - `totalTime` 또는 `intervalTime` 이 없는 후보는 후순위로 보낸다.
     누락 값을 0분으로 보면 정보가 없다는 이유로 오히려 유리해지기 때문이다.
2. 예상 총 소요시간이 같으면 `totalWalk` 가 짧은 순
3. 위 순서로 정렬한 뒤에 같은 `routeNo` 를 하나만 남기고, 앞에서부터 최대 2개까지 선택
   - 중복 제거를 정렬보다 먼저 하면, 같은 노선이 여러 경로로 올라올 때 점수 비교도
     받지 못한 채 느린 후보가 남을 수 있으므로 순서를 바꾸지 않는다.

## 호출 위치

| 백엔드 API | 호출 함수 |
|---|---|
| POST /api/routes/search | generateRouteGuide |
| POST /api/trips | generateTripStartGuide |
| PATCH /api/trips/{tripId}/status | generateMovingGuide |
| 오류 상황 | generateErrorGuide |

## 반환 형식
- `generateRouteGuide` → `{ selectedCandidates: [{ candidateId, guideMessage }] }`
- 나머지 함수 → `{ guideMessage: string }`

## import 예시
```ts
import { generateRouteGuide } from "../guide.js";
```

TypeScript 파일이지만 서버는 ESM 출력 기준으로 `.js` 확장자를 붙여 import한다.

## 환경 변수
```
OPENAI_API_KEY=your_openai_api_key
```

`OPENAI_API_KEY`가 없거나 OpenAI 호출이 실패하면 서버는 기본 안내 문장으로 fallback한다.

## 사용 모델
- gpt-4o-mini
