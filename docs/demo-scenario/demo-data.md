# 시연 데이터

단일 출처는 `packages/shared/src/fixtures/`다. 실제 운영 노선과 이 고정 fixture를 혼동하지 않는다.

## 고정 경로 fixture

| 필드 | 값 |
|---|---|
| candidateId | 7 |
| routeNo | 1551 |
| localBusId | 234001138 |
| gbisStationId | 233001214 |
| 승차 / 하차 | 수원대학교 / 병점역후문 |
| stationList | sequence 0부터 10까지 총 11개 |

세부 좌표와 정류장 이름은 [demo-route.ts](../../packages/shared/src/fixtures/demo-route.ts)를 사용한다. 문서에 좌표 배열을 따로 복사해 유지하지 않는다.

## mock GPS 입력

[demo-locations.ts](../../packages/shared/src/fixtures/demo-locations.ts)의 `demo-loc-00`부터 `demo-loc-10`까지 사용한다. 탑승확정 후 sequence 8(동문아파트)은 2정류장 전 안내, sequence 9(진안5통.병점육교)는 1정류장 전 벨 요청, sequence 10(병점역후문)은 도착이다. 실제 GPS 검증에는 오래된 fixture의 recordedAt을 그대로 사용하지 않는다.

## 비콘 fixture

| routeNo | beaconId | targetBeaconId | isMock |
|---|---|---|---|
| 1551 | BUSTA-1551-DEMO01 | BUS_1551_001 | false |
| 35 | BUSTA-35-DEMO01 | BUS_35_001 | false |

출처: [demo-beacon.ts](../../packages/shared/src/fixtures/demo-beacon.ts). DB 설정 시에는 ACTIVE DB 행을 조회하며, 이 fixture 표가 현재 운영 DB 내용의 증거는 아니다. 실제 광고 이름과 API의 targetBeaconId를 시연 전에 대조한다.
