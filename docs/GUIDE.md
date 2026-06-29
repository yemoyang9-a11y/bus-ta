# guide.js — AI 안내 문장 생성 모듈

## 역할
시각장애인 버스 승하차 보조 앱(BUS-TA)의 AI 안내 문장 생성 담당 모듈이다.
예모 백엔드가 `require("./guide")`로 import하여 호출한다.

## 파일
- `guide.js` — 안내 문장 생성 함수 모음

## 함수 목록

| 함수명 | 역할 | OpenAI 사용 |
|---|---|---|
| generateRouteGuide | 노선 후보 안내 문장 생성 + 최대 2개 선택 | O |
| generateTripStartGuide | 탑승 대기 안내 문장 생성 | O |
| generateMovingGuide | 이동 중 안내 문장 생성 | O |
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

## 환경 변수
```
OPENAI_API_KEY=your_openai_api_key
```

## 사용 모델
- gpt-4o-mini
