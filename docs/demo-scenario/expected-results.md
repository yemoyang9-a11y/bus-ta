# 시연 단계별 기대 결과

## 위치 전송과 상태 전환

| mock 좌표 | 가까운 정류장 | 기대 tripStatus | 남은 정류장 |
| --- | --- | --- | --- |
| demo-loc-01 | 출발 정류장 | ON_BUS | 3 |
| demo-loc-02 | 중간 정류장 1 | ON_BUS | 2 |
| demo-loc-03 | 중간 정류장 2 | NEAR_DESTINATION | 1 |
| demo-loc-04 | 목적지 정류장 | TRIP_DONE | 0 |

## 하차벨 상태 전환

| 단계 | API | 기대 bellStatus |
| --- | --- | --- |
| 초기 | 운행 생성 | NOT_REQUESTED |
| 자동 요청 생성 | PATCH /api/trips/{tripId}/status | PENDING |
| 성공 결과 | POST /api/trips/{tripId}/bell/result | SUCCESS |
| 실패 결과 | POST /api/trips/{tripId}/bell/result | FAIL |

`/bell/request`는 사용하지 않는다.
