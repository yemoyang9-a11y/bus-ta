/**
 * 서버 → 스마트 하차벨 하드웨어로 전송하는 명령.
 * MVP 흐름에서는 하차 1정거장 전 자동 생성되는 STOP_REQUEST 단일 명령으로 통일한다.
 */
export const BELL_COMMAND = {
  STOP_REQUEST: "STOP_REQUEST",
} as const;

export type BellCommand = (typeof BELL_COMMAND)[keyof typeof BELL_COMMAND];
