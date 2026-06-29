# 시연 API 호출 순서

> 시연 데이터는 [demo-data.md](demo-data.md), 기대 결과는 [expected-results.md](expected-results.md)를 함께 확인한다.

## 1단계: 서버 확인

```http
GET /api/health
```

## 2단계: 운행 생성

```http
POST /api/trips
```

사용자가 선택한 후보 객체를 전달하고 `tripId`를 받는다. 도착 예정 정보는 백엔드가 내부에서 `getArrivalInfo(selectedCandidate)`로 조회한다.

## 3단계: 위치 업데이트 시작

```http
PATCH /api/trips/{tripId}/status
```

앱은 3초마다 `requestId`, 현재 좌표, 기록 시각을 전송한다. `apps/mobile/src/demo/demo-runner.ts`는 중간평가용 mock 좌표를 순서대로 전송한다.

## 4단계: 상태 조회

```http
GET /api/trips/{tripId}/status
```

현재 정류장, 다음 정류장, 남은 정류장 수, 안내 메시지를 조회한다. 조회 API는 상태를 변경하지 않는다.

## 5단계: 하차벨 요청 자동 생성

```http
PATCH /api/trips/{tripId}/status
```

백엔드가 `remainingStations = 1`과 `bellStatus = NOT_REQUESTED`를 감지하면 `bellRequestId`, `command: STOP_REQUEST`, `shouldTriggerBell: true`를 응답하고 `bellStatus = PENDING`으로 저장한다.

## 6단계: 하차벨 결과 저장

```http
POST /api/trips/{tripId}/bell/result
```

앱은 같은 `bellRequestId`로 mock 또는 실제 하차벨 결과를 저장한다.

## 7단계: 운행 종료

```http
PATCH /api/trips/{tripId}/status
```

목적지 도착 좌표가 처리되면 `tripStatus = TRIP_DONE` 상태를 확인한다.
