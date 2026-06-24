# 데이터 흐름

## 탑승 여정 흐름

```
1. 앱이 POST /api/trips 로 여정 생성 → tripId 수신

2. 앱이 주기적으로 위치(lat, lng, requestId)를 서버에 전송
   └─ PATCH /api/trips/{tripId}/status (위치 포함)
   └─ 서버: requestId 중복 확인 → 정류장 계산 → tripStatus 갱신

3. 앱이 GET /api/trips/{tripId}/status 로 현재 상태 폴링
   └─ 상태 변경 없음 (읽기 전용)

4. tripStatus = NEAR_DESTINATION 도달 시
   └─ 앱 또는 서버가 POST /api/trips/{tripId}/bell/request
   └─ 서버: bellStatus NOT_REQUESTED → PENDING, 하차벨 명령 전송

5. 스마트 하차벨이 동작 후 POST /api/trips/{tripId}/bell/result 보고
   └─ 서버: bellStatus PENDING → SUCCESS | FAIL

6. tripStatus = TRIP_DONE 시 여정 종료
```

## 식별자 흐름

- `requestId`: 위치 업데이트마다 앱이 생성 → 서버가 중복 방지에만 사용 → `bell/request`에 사용 금지
- `bellRequestId`: `bell/request` 시 앱이 생성 → `bell/result` 매칭에만 사용 → 위치 업데이트에 사용 금지
