# 시연 API 호출 순서

> 전체 데이터: `docs/demo-scenario/demo-data.md`  
> 기대 결과: `docs/demo-scenario/expected-results.md`

## 1단계: 서버 확인
```
GET /api/health
→ { status: "ok" }
```

## 2단계: 여정 생성
```
POST /api/trips
Body: { routeId, boardingStationId, alightingStationId }
→ { tripId: "..." }
```

## 3단계: 위치 업데이트 시작 (mock 좌표 순서대로)
```
PATCH /api/trips/{tripId}/status
Body: { tripId, requestId, lat, lng, timestamp }
→ { status: "ON_BUS", remainingStops: 3 }
```
apps/mobile/src/demo/demo-runner.ts 에서 자동 전송.

## 4단계: 상태 조회
```
GET /api/trips/{tripId}/status
→ { status: "NEAR_DESTINATION", remainingStops: 1 }
```

## 5단계: 하차벨 요청
```
POST /api/trips/{tripId}/bell/request
Body: { tripId, bellRequestId: "req-001" }
→ { bellStatus: "PENDING" }
```

## 6단계: 하차벨 결과 수신 (mock-bell.adapter가 생성)
```
POST /api/trips/{tripId}/bell/result
Body: { tripId, bellRequestId: "req-001", success: true, respondedAt: "..." }
→ { bellStatus: "SUCCESS" }
```

## 7단계: 여정 종료
```
PATCH /api/trips/{tripId}/status
Body: { status: "TRIP_DONE" }
```
