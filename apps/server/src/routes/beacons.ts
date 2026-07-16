import { Router } from "express";
import { FixtureBeaconRepository } from "../repositories/beacon.repository.js";
import { createSupabaseBeaconRepositoryFromEnv } from "../repositories/supabase/beacon.repository.js";
import { getBeaconByRoute } from "../services/beacon/get-beacon.service.js";

export const beaconsRouter = Router();

// Supabase 설정이 있으면 실제 bus_beacons 테이블을 조회하고,
// 없으면 fixture(DEMO_BEACONS)로 시연이 끊기지 않게 한다.
const beaconRepository = createSupabaseBeaconRepositoryFromEnv() ?? new FixtureBeaconRepository();

// GET /api/beacons?routeNo=
beaconsRouter.get("/", async (req, res) => {
  const result = await getBeaconByRoute(req.query["routeNo"], beaconRepository);
  res.status(result.httpStatus).json(result.body);
});
