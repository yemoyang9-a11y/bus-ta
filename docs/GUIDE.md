# guide.ts — AI 안내 문장 생성 모듈

## 역할
시각장애인 버스 승하차 보조 앱(BUS-TA)의 AI 안내 문장 생성 담당 모듈이다.
예모 백엔드는 TypeScript/ESM 기준으로 `import { generateRouteGuide } from "../guide.js"`처럼 import하여 호출한다.

## 파일
- `apps/server/src/services/guide.ts` — 안내 문장 생성 함수 모음

## 함수 목록

| 함수명 | 역할 | OpenAI 사용 |
|---|---|---|
| generateRouteGuide | 노선 후보 안내 문장 생성 + 최대 2개 선택 | O, 키 없으면 fallback |
| generateTripStartGuide | 탑승 대기 안내 문장 생성 | O, 키 없으면 fallback |
| generateMovingGuide | 이동 중 안내 문장 생성 | O, 키 없으면 fallback |
| generateErrorGuide | 오류 fallback 문장 반환 | X |

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
