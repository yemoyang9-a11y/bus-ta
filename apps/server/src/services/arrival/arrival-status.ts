/**
 * 도착정보 "조회 결과"의 상태. 도착 차량의 속성(occupancy.type)과는 다른 층이다.
 *
 * arrivals 가 빈 배열인 이유를 호출부가 구분하지 못하면, GBIS 장애를 "오는 차가
 * 없음"으로 안내하게 된다. 시각장애인 사용자가 그 안내를 듣고 정류장을 떠나면
 * 실제로는 오고 있던 버스를 놓친다. 두 경우는 반드시 다르게 안내해야 한다.
 *
 * 어댑터와 캐시가 함께 쓰는 서버 내부 계약이라 어느 한쪽에 두지 않는다.
 * 공개 API 계약이 확정되면 `packages/shared` 의 타입·Zod Schema 로 옮긴다.
 */
export const ARRIVAL_STATUS = {
  /** 조회에 성공했고 안내할 도착 차량이 있다. */
  AVAILABLE: "AVAILABLE",
  /** 조회에 성공했고 이 노선 레코드 자체가 없다 = 지금 오는 차가 없다. */
  NO_VEHICLE: "NO_VEHICLE",
  /**
   * 레코드는 있는데 예상 도착 시간이 없다.
   *
   * "오는 차가 없다"와 다르다. GBIS 공식 문서에서 빈 predictTime 이 차량 없음을
   * 뜻한다고 확인한 적이 없고, 실제 캡처에도 두 순번이 모두 빈 사례가 없다.
   * 근거 없이 "오는 버스가 없습니다"라고 안내하면 사용자가 정류장을 떠난다.
   */
  NO_PREDICTION: "NO_PREDICTION",
  /** 조회하지 못했거나 방향을 확인하지 못했다. "차가 없다"고 단정하면 안 된다. */
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
} as const;

export type ArrivalStatus = (typeof ARRIVAL_STATUS)[keyof typeof ARRIVAL_STATUS];
