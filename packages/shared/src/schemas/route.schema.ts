import { z } from "zod";
import { ArrivalInfoSchema } from "./arrival.schema.js";

export const RoutesSearchRequestSchema = z.object({
  destination: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type RoutesSearchRequest = z.infer<typeof RoutesSearchRequestSchema>;

export const StationSchema = z.object({
  stationName: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  sequence: z.number().int().nonnegative().optional(),
});

export const StationListItemSchema = StationSchema.extend({
  sequence: z.number().int().nonnegative(),
});

export const RouteCandidateSchema = z.object({
  candidateId: z.number().int().positive(),
  routeNo: z.string().min(1),
  localBusId: z.string().min(1),
  gbisStationId: z.string().min(1),
  boardingStation: StationSchema,
  destinationStation: StationSchema,
  stationList: z.array(StationListItemSchema).min(2),
  totalTime: z.number().int().nonnegative().optional(),
  totalWalk: z.number().int().nonnegative().optional(),
  payment: z.number().int().nonnegative().optional(),
  busTransitCount: z.number().int().nonnegative().optional(),
  busStationCount: z.number().int().nonnegative().optional(),
  totalDistance: z.number().int().nonnegative().optional(),
  intervalTime: z.number().int().nonnegative().optional(),
  recommendationReason: z.string().optional(),
  guideMessage: z.string().optional(),
  // 선택 전에도 도착 예정 시간을 안내할 수 있도록 추천 후보에만 실어 보낸다.
  //
  // 세 상태를 구분한다.
  // - 값 있음: 도착 예정 차량이 있다
  // - 빈 배열: 조회는 됐지만 실시간 차량이 없다
  // - 필드 없음: 조회에 실패해 확인하지 못했다
  //
  // create_trip 응답의 arrivals 와 같은 형태를 쓰되, 여기 값은 검색 시점 기준이라
  // 탑승 안내는 create_trip 응답을 다시 사용한다.
  arrivals: z.array(ArrivalInfoSchema).max(2).optional(),
});

export const RoutesSearchResponseSchema = z.object({
  success: z.boolean(),
  destination: z.string(),
  routes: z.array(RouteCandidateSchema),
  message: z.string().optional(),
  timestamp: z.string().optional(),
});
export type RoutesSearchResponse = z.infer<typeof RoutesSearchResponseSchema>;
