/**
 * 브랜디드 타입 — 식별자 종류를 타입 수준에서 강제로 구분한다.
 *
 * requestId    : GPS/mock 위치 업데이트 중복 요청 판정 전용
 * bellRequestId: 하차벨 요청 ↔ /bell/result 결과 연결 전용
 *
 * 두 타입은 string 기반이지만 상호 대입이 불가하다.
 */
declare const _brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [_brand]: B };

export type TripId = Brand<string, "TripId">;
export type BeaconId = Brand<string, "BeaconId">;

/** GPS 또는 mock 위치 업데이트의 중복 요청 판정용 */
export type RequestId = Brand<string, "RequestId">;

/** 하차벨 요청과 /bell/result 결과를 연결하는 식별자 */
export type BellRequestId = Brand<string, "BellRequestId">;

// 편의 생성 함수 (런타임에는 plain string, 타입만 강제)
export const asTripId = (s: string): TripId => s as TripId;
export const asBeaconId = (s: string): BeaconId => s as BeaconId;
export const asRequestId = (s: string): RequestId => s as RequestId;
export const asBellRequestId = (s: string): BellRequestId => s as BellRequestId;
