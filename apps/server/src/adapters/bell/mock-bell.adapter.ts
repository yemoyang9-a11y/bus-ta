import type { BellRequestId, TripId } from "@bus-ta/shared";

export interface BellAdapterResult {
  success: boolean;
  failReason?: string;
  respondedAt: string;
}

/**
 * Mock 하차벨 어댑터 — 시연용
 *
 * 실제 하드웨어(스마트 하차벨) 대신 PENDING → SUCCESS/FAIL 결과를 생성한다.
 * 실제 어댑터가 준비되면 동일 인터페이스의 구현체로 교체한다.
 */
export class MockBellAdapter {
  private successRate: number;

  constructor(successRate = 0.9) {
    this.successRate = successRate;
  }

  async sendRequest(
    _tripId: TripId,
    _bellRequestId: BellRequestId,
  ): Promise<BellAdapterResult> {
    // TODO: 실제 하차벨 하드웨어 연동 시 이 구현체를 교체
    const success = Math.random() < this.successRate;
    return {
      success,
      failReason: success ? undefined : "MOCK_HARDWARE_TIMEOUT",
      respondedAt: new Date().toISOString(),
    };
  }
}
