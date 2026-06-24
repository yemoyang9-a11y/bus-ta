/** 서버 → 스마트 하차벨 하드웨어로 전송하는 명령 */
export const BELL_COMMAND = {
  RING: "RING",
  CANCEL: "CANCEL",
} as const;

export type BellCommand = (typeof BELL_COMMAND)[keyof typeof BELL_COMMAND];
