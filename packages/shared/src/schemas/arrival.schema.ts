import { z } from "zod";

/**
 * 도착 예정 차량 한 대의 혼잡도 정보.
 *
 * type 이 어떤 값을 담고 있는지 결정한다.
 * - CONGESTION: congestionLevel 1~4, remainingSeats 는 null
 * - REMAINING_SEATS: remainingSeats 0 이상, congestionLevel 은 null
 * - UNAVAILABLE: 둘 다 null
 *
 * `remainingSeats: 0` 에 대하여 (이 필드를 좁히기 전에 반드시 읽을 것)
 *
 * 계약상 `0` 은 유효값이고 그 뜻은 "정보 없음"이 아니라 **만석**이다.
 * 그래서 스키마는 `.nonnegative()` 로 `0` 을 허용한다. 의도된 것이다.
 *
 * GBIS 공식 문서(gbis.go.kr) 확인 결과 `remainSeatCnt` 의 "정보없음" sentinel 은
 * `-1` 뿐이고 `0` 은 "0석 남음"(만석)을 뜻하는 정상 값이다. 또한 `crowded`·
 * `remainSeatCnt` 는 한 버스가 상황에 따라 둘 다 줄 수 있는 값이 아니라, 노선유형
 * (`routeTypeCd`)이 애초에 어느 필드를 채우는지를 결정한다 — 좌석형 노선유형
 * (직행좌석형시내 등)은 만석이면 실제로 `remainSeatCnt=0` 을 낸다. 어댑터는 이제
 * 노선유형이 좌석형 집합에 속하면 `remainSeatCnt` 만 읽고 `-1` 만 정보없음으로
 * 처리하므로 `0` 이 실제로 나갈 수 있다. 자세한 분기는
 * `apps/server/src/adapters/routes/hyorin-route-search.adapter.ts` 의
 * `toOccupancy` 를 참고한다.
 *
 * 이 필드를 `.positive()` 로 좁히면 계약이 허용하는 값을 거부하게 되므로 좁히지 말 것.
 */
export const OccupancySchema = z
  .object({
    type: z.enum(["CONGESTION", "REMAINING_SEATS", "UNAVAILABLE"]),
    congestionLevel: z.number().int().min(1).max(4).nullable(),
    remainingSeats: z.number().int().nonnegative().nullable(),
  })
  .superRefine((value, ctx) => {
    const expected =
      value.type === "CONGESTION"
        ? { congestionLevel: true, remainingSeats: false }
        : value.type === "REMAINING_SEATS"
          ? { congestionLevel: false, remainingSeats: true }
          : { congestionLevel: false, remainingSeats: false };

    if (expected.congestionLevel !== (value.congestionLevel !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["congestionLevel"],
        message: `occupancy.type=${value.type}에서 congestionLevel 값이 계약과 맞지 않습니다.`,
      });
    }

    if (expected.remainingSeats !== (value.remainingSeats !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remainingSeats"],
        message: `occupancy.type=${value.type}에서 remainingSeats 값이 계약과 맞지 않습니다.`,
      });
    }
  });
export type Occupancy = z.infer<typeof OccupancySchema>;

export const ArrivalInfoSchema = z.object({
  predictedArrivalMinutes: z.number().int().nonnegative(),
  occupancy: OccupancySchema,
});
export type ArrivalInfo = z.infer<typeof ArrivalInfoSchema>;
