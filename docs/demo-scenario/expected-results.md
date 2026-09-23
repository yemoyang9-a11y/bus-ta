# 시연 단계별 기대 결과

## 위치 전송과 탑승확정

`POST /trips` 직후에는 WAITING_BUS다. GPS를 보내도 탑승확정 전에는 WAITING_BUS와 NOT_REQUESTED를 유지한다. `POST /trips/{tripId}/boarding/confirm`의 성공 응답 이후 아래 이동 결과를 기대한다.

| fixture 입력 | 정류장 | tripStatus | 남은 정류장 | 벨 |
|---|---|---|---|---|
| demo-loc-00 | 수원대학교 | ON_BUS | 10 | 생성하지 않음 |
| demo-loc-08 | 동문아파트 | ON_BUS | 2 | 준비 안내만 |
| demo-loc-09 | 진안5통.병점육교 | NEAR_DESTINATION | 1 | NOT_REQUESTED일 때 PENDING 한 번 |
| demo-loc-10 | 병점역후문 | TRIP_DONE | 0 | 추가 생성 없음 |

입력은 sequence 순서를 따른다. 사용자 수동 확인은 USER_CONFIRMED, 앱 자동 확인은 AUTO_DETECTED로 따로 기록한다.

## 하차벨 상태 전환

| 단계 | API | bellStatus |
|---|---|---|
| 운행 생성 | POST /api/trips | NOT_REQUESTED |
| 자동 요청 | PATCH /api/trips/{tripId}/status | PENDING |
| 결과 확정 | POST /api/trips/{tripId}/bell/result | SUCCESS 또는 FAIL |

같은 bellRequestId 재전송은 처음 확정된 결과를 보존한다. PENDING/SUCCESS/FAIL에서 새 물리 벨 요청을 생성하지 않는다. `/bell/request`는 사용하지 않는다.

하차벨 화면 이동이 GPS 종료를 뜻하지 않는다. 목적지 도착까지 추적하고 종료 안내 후 상태를 정리하는 실제 앱 검증은 [실물 재검증 표](../DEMO_SCENARIO.md)의 8–12번으로 확인한다. 이 표는 통과 기록이 아닌 기대 결과다.
