import type { BellRequestId, TripId } from "@bus-ta/shared";
import { BELL_COMMAND, BELL_STATUS } from "@bus-ta/shared";

export interface BellAdapterResult {
  command: typeof BELL_COMMAND.STOP_REQUEST;
  result: typeof BELL_STATUS.SUCCESS | typeof BELL_STATUS.FAIL;
  resultMessage?: string;
  isMock: boolean;
  timestamp: string;
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
    const timestamp = new Date().toISOString();

    if (success) {
      return {
        command: BELL_COMMAND.STOP_REQUEST,
        result: BELL_STATUS.SUCCESS,
        isMock: true,
        timestamp,
      };
    }

    return {
      command: BELL_COMMAND.STOP_REQUEST,
      result: BELL_STATUS.FAIL,
      resultMessage: "MOCK_HARDWARE_TIMEOUT",
      isMock: true,
      timestamp,
    };
  }
}
