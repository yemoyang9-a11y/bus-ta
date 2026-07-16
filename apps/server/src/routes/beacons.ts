import { Router } from "express";
import { FixtureBeaconRepository } from "../repositories/beacon.repository.js";
import { createSupabaseBeaconRepositoryFromEnv } from "../repositories/supabase/beacon.repository.js";
import { getBeaconByRoute } from "../services/beacon/get-beacon.service.js";

export const beaconsRouter = Router();

// GET /api/beacons?routeNo=
beaconsRouter.get("/", async (req, res) => {
  // 요청마다 평가한다(모듈 로드 시점에 고정하면 index.ts의 .env 로드보다
  // 먼저 실행되어 Supabase 설정이 있어도 항상 fixture로 빠지는 문제가 있었다).
  // Supabase 설정이 있으면 실제 bus_beacons 테이블을 조회하고,
  // 없으면 fixture(DEMO_BEACONS)로 시연이 끊기지 않게 한다.
  const beaconRepository = createSupabaseBeaconRepositoryFromEnv() ?? new FixtureBeaconRepository();
  const result = await getBeaconByRoute(req.query["routeNo"], beaconRepository);
  res.status(result.httpStatus).json(result.body);
});
