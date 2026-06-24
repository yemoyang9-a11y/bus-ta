# 시연 단계별 기대 결과

## 위치 전송 → 상태 전환

| mock 좌표 | 가장 가까운 정류장 | 기대 tripStatus | 남은 정류장 |
|---|---|---|---|
| demo-loc-01 | demo-st-01 (출발) | ON_BUS | 3 |
| demo-loc-02 | demo-st-02 (중간1) | ON_BUS | 2 |
| demo-loc-03 | demo-st-03 (중간2) | NEAR_DESTINATION | 1 |
| demo-loc-04 | demo-st-04 (도착) | TRIP_DONE | 0 |

## 하차벨 상태 전환

| 단계 | API | 기대 bellStatus |
|---|---|---|
| 초기 | — | NOT_REQUESTED |
| 요청 | POST /bell/request | PENDING |
| 성공 결과 | POST /bell/result (success: true) | SUCCESS |
| 실패 결과 | POST /bell/result (success: false) | FAIL |
| 실패 후 재시도 | POST /bell/request | PENDING |
