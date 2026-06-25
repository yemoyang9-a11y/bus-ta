# 데이터 흐름

## 탑승 및 이동 상태 흐름

```text
1. 앱이 POST /api/trips로 운행을 생성하고 tripId를 받는다.
2. 앱이 3초마다 GPS 또는 mock 좌표를 PATCH /api/trips/{tripId}/status로 전송한다.
3. 백엔드는 requestId 중복 여부를 확인하고 DB의 stationList와 현재 좌표를 비교한다.
4. 백엔드는 현재 정류장, 다음 정류장, 남은 정류장 수, tripStatus를 계산해 저장한다.
5. 앱은 GET /api/trips/{tripId}/status로 현재 상태를 조회할 수 있다. 이 조회는 상태를 바꾸지 않는다.
6. remainingStations = 1이고 bellStatus = NOT_REQUESTED이면 백엔드가 PATCH /status 처리 중 bellRequestId와 STOP_REQUEST를 자동 생성한다.
7. 앱은 응답의 STOP_REQUEST를 mock 또는 실제 하차벨에 전달한다.
8. 앱은 POST /api/trips/{tripId}/bell/result로 하차벨 결과를 저장한다.
9. 목적지 도착 시 tripStatus = TRIP_DONE으로 종료한다.
```

## 식별자 흐름

- `requestId`: 위치 업데이트 멱등성 확인용이다.
- `bellRequestId`: 하차벨 요청과 결과 연결용이다.
- `/bell/request`는 사용하지 않는다.
