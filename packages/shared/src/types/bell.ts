import type { TripId, BellRequestId } from "./ids.js";
import type { BellStatus } from "../constants/bell-status.js";

export interface BellState {
  tripId: TripId;
  status: BellStatus;
  updatedAt: string;
}

export interface BellRequest {
  tripId: TripId;
  /**
   * 하차벨 요청과 /bell/result 결과를 연결하는 식별자 전용.
   * requestId(위치 업데이트용) 와 혼용 금지.
   */
  bellRequestId: BellRequestId;
}

export interface BellResult {
  tripId: TripId;
  bellRequestId: BellRequestId;
  success: boolean;
  failReason?: string;
  respondedAt: string;
}
