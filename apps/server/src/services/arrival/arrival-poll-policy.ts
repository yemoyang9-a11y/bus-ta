/**
 * 도착정보 재조회 주기와 비콘 스캔 시작 시점을 정하는 정책.
 *
 * 근거가 된 실측 (2026-08-24, GBIS 20초 간격 12회):
 * - 심야 00:24 수원대·사당, 퇴근 18:42 사당(24개 노선)·수원대(15개 노선)
 * - 예측값이 줄어드는 속도는 러시아워에도 실시간의 최대 1.5배였다.
 *   (예: 210번이 4분 동안 18분 → 12분)
 * - 대신 값이 "되돌아가는" 경우가 러시아워에 흔했다. 사당 24개 중 10개,
 *   수원대 15개 중 4개. 이는 예측이 틀린 것이 아니라 앞차가 도착·출발해서
 *   다음 차량 정보로 교체된 것이다. (720-2: 1분 → 9분)
 * - 단발성 이상치도 실재한다. (1008번: 37분 → 1분 → 37분)
 */

/** 도착이 임박했을 때의 최소 재조회 간격. 이보다 자주 부르지 않는다. */
export const ARRIVAL_POLL_MIN_MS = 20_000;

/** 버스가 멀리 있어도 이 주기로는 한 번씩 확인한다. */
export const ARRIVAL_POLL_MAX_MS = 5 * 60_000;

/** 이 시간 이내로 들어오면 비콘 스캔을 시작한다. */
export const BEACON_SCAN_TRIGGER_MINUTES = 5;

/** 이 시간 이내면 1분마다 확인한다. */
export const ARRIVAL_POLL_NEAR_MINUTES = 5;
/** 이 시간 이내면 30초마다 확인한다. */
export const ARRIVAL_POLL_IMMINENT_MINUTES = 4;

const ONE_MINUTE_MS = 60_000;
const THIRTY_SECONDS_MS = 30_000;

/**
 * 다음 재조회까지 기다릴 시간.
 *
 * 도착이 가까울수록 촘촘하게 확인한다. 버스를 놓치는 건 대부분 막판이라, 남은
 * 시간이 짧은 구간에 조회를 몰아준다.
 *
 * - 4분 이하  : 30초마다. 이 구간에서 한 번 놓치면 버스가 그냥 지나간다.
 * - 5분 이하  : 1분마다. 비콘 스캔이 켜지는 시점(BEACON_SCAN_TRIGGER_MINUTES)과 같다.
 * - 그보다 멀면: 남은 시간의 절반. 실측상 예측값은 최대 1.5배 속도로 줄어들어,
 *   절반을 기다려도 다음 조회 시점에 25%가 남는다. 최대 5분을 넘기지 않는다.
 *
 * 도착정보가 없으면(심야·미운행·GBIS 미수록 노선) 최대 간격으로 재시도한다.
 * 값이 없다고 조회를 멈추면 나중에 운행이 시작돼도 알아채지 못한다.
 */
export function nextArrivalPollDelayMs(predictedArrivalMinutes: number | null): number {
  if (predictedArrivalMinutes == null || !Number.isFinite(predictedArrivalMinutes)) {
    return ARRIVAL_POLL_MAX_MS;
  }

  const remaining = Math.max(0, predictedArrivalMinutes);

  if (remaining <= ARRIVAL_POLL_IMMINENT_MINUTES) return THIRTY_SECONDS_MS;
  if (remaining <= ARRIVAL_POLL_NEAR_MINUTES) return ONE_MINUTE_MS;

  const halfRemainingMs = (remaining / 2) * ONE_MINUTE_MS;
  return Math.min(ARRIVAL_POLL_MAX_MS, Math.max(ARRIVAL_POLL_MIN_MS, halfRemainingMs));
}

/**
 * 지금 비콘 스캔이 켜져 있어야 하는지.
 *
 * 두 가지 원칙이 있다.
 *
 * 1. 한 번 켜면 끄지 않는다(alreadyScanning이 true면 항상 true).
 *    도착정보는 앞차가 떠나면 다음 차 기준으로 값이 커진다. 이때 스캔을 끄면
 *    정작 버스가 눈앞에 온 순간에 꺼져 탑승을 놓친다.
 *
 * 2. 도착정보가 없으면 스캔을 켠다.
 *    GBIS에 없는 노선이거나 실시간 값이 비어 있을 때 스캔을 막으면 비콘 감지가
 *    영영 시작되지 않아 자동 탑승 판정 자체가 동작하지 않는다. 배터리보다
 *    탑승을 놓치지 않는 쪽을 우선한다.
 */
export function shouldScanBeacon(
  predictedArrivalMinutes: number | null,
  alreadyScanning = false,
): boolean {
  if (alreadyScanning) return true;
  if (predictedArrivalMinutes == null || !Number.isFinite(predictedArrivalMinutes)) return true;

  return predictedArrivalMinutes <= BEACON_SCAN_TRIGGER_MINUTES;
}
