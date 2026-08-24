# Boarding Confirmation Implementation Plan

> **For Codex:** Execute this plan in the isolated worktree. Do not commit, push, or apply the migration to a remote Supabase project in this run.

**Goal:** Prevent GPS-only false boarding, add an atomic boarding-confirmation API shared by explicit voice and frontend BLE auto-detection, and block destination/bell transitions until boarding is confirmed.

**Architecture:** `trip_status` remains the current-state row in Supabase and gains boarding evidence metadata. Both `USER_CONFIRMED` and frontend-produced `AUTO_DETECTED` evidence call one REST endpoint, whose server service invokes a single atomic Postgres RPC. Location updates continue to log progress while `WAITING_BUS`, but cannot advance the trip state or trigger the bell until `boarding_confirmed_at` exists.

**Tech Stack:** TypeScript, Zod, Express, Supabase Postgres/PostgREST RPC, React Native, OpenAI Realtime function tools, Node test runner.

**Spec:** [Notion - 버스 탑승 여부 판단 2차 상세 설계](https://app.notion.com/p/3c4ff779d69181edbd1cc49f187b4a88)

---

## Task 1: Shared contract

**Files:**
- Create: `packages/shared/src/constants/boarding-method.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/constants/api-paths.ts`
- Modify: `packages/shared/src/schemas/trip.schema.ts`
- Modify: `packages/shared/src/types/trip.ts`
- Test: `packages/shared/src/schemas/latest-contract.typecheck.ts`

1. Add failing type/schema contract cases for `USER_CONFIRMED`, `AUTO_DETECTED`, response metadata, and the boarding API path.
2. Add `BOARDING_METHOD`, discriminated request schema, confirmation response schema, and status response boarding fields.
3. Run shared typecheck and a focused runtime schema test.

## Task 2: Atomic Supabase persistence

**Files:**
- Create: `supabase/migrations/<timestamp>_add_boarding_confirmation.sql`
- Modify: `apps/server/src/repositories/supabase/trip.repository.ts`
- Test: `apps/server/src/repositories/supabase/trip.repository.test.ts`

1. Add failing repository tests for confirmed, idempotent, missing, invalid-status, and inconsistent RPC outcomes.
2. Create a migration adding `boarding_method`, `boarding_confirmed_at`, `boarding_request_id`, and `boarding_detected_at`, consistency checks, and a security-hardened `confirm_trip_boarding` RPC executable only by `service_role`.
3. Map the RPC outcomes in the Supabase repository and expose boarding metadata in status reads.
4. Run repository and Supabase security tests.

## Task 3: Server confirmation API

**Files:**
- Create: `apps/server/src/services/trip/confirm-boarding.service.ts`
- Create: `apps/server/src/services/trip/confirm-boarding.service.test.ts`
- Modify: `apps/server/src/routes/trips.ts`

1. Add failing service tests covering explicit voice success, automatic evidence timestamp validation, replay, missing trip, terminal state, inconsistent state, and DB failure.
2. Implement `POST /api/trips/:tripId/boarding/confirm` and its service.
3. Make the server timestamp authoritative and preserve the database winner on idempotent replay.
4. Run the focused service tests.

## Task 4: GPS and bell safety gate

**Files:**
- Modify: `apps/server/src/services/trip/update-trip-status.service.ts`
- Modify: `apps/server/src/services/trip/update-trip-status.service.test.ts`
- Modify: `apps/server/src/services/trip/get-trip-status.service.ts`
- Modify: `apps/server/src/services/trip/get-trip-status.service.test.ts`
- Modify: `supabase/migrations/<timestamp>_add_boarding_confirmation.sql`

1. Change the old first-GPS test to require `WAITING_BUS` and add regression tests preventing near/done/bell before confirmation.
2. Preserve location logging and progress fields while waiting, but keep `trip_status=WAITING_BUS` and `shouldTriggerBell=false`.
3. Require boarding metadata for ON_BUS/NEAR/TRIP_DONE transitions and bell generation in both service logic and the atomic location RPC.
4. Return boarding metadata in status responses and run focused tests.
5. If the database observes confirmed boarding while an in-flight GPS payload still says `WAITING_BUS`, do not consume the location `requestId`; return an internal retry result so the server can re-read and recalculate once.

## Task 5: Realtime function and app state

**Files:**
- Modify: `apps/mobile/src/realtime/guide.ts`
- Modify: `apps/mobile/src/realtime/types.ts`
- Modify: `apps/mobile/src/realtime/function-dispatcher.ts`
- Modify: `apps/mobile/src/api/client.ts`
- Modify: `apps/mobile/src/state/TripContext.js`
- Modify: `apps/mobile/src/screens/RidingScreen.js`
- Test: add focused Node tests where modules are platform-independent

1. Add `confirm_boarding` with an empty model argument schema; the dispatcher supplies active `tripId`, a generated `requestId`, and `USER_CONFIRMED`.
2. Reject a delayed confirmation response if its `tripId` no longer matches the active app trip.
3. Ensure concurrent identical confirmations share backend work while each Realtime call receives its own `call_id` response.
4. Update app state only from a successful server response; expose the same API method for frontend BLE to call with `AUTO_DETECTED`.
5. Display `버스 탑승 대기` for `WAITING_BUS`; stop BLE scanning only after confirmed boarding metadata is present.
5. Run mobile and workspace typechecks.

## Task 6: Contract documentation sync

**Files:**
- Modify: `docs/API_SPEC.md`
- Modify: `docs/DB_SCHEMA.md`
- Modify: `docs/MODULE_CONTRACTS.md`
- Modify: `docs/FRONTEND_GUIDE.md`
- Modify: `docs/REALTIME_GUIDE.md`
- Modify: `docs/PROJECT_OVERVIEW.md`
- Modify: relevant authoritative Notion pages

1. Document the endpoint, request union, response/error semantics, DB columns/RPC, ownership boundary, explicit-voice rule, waiting GPS behavior, and bell gate.
2. Update the authoritative Notion documents without duplicating pages.
3. Re-read all changed docs and compare names, enums, paths, timestamps, and ownership against code.

## Task 7: Full verification and handoff

1. Run shared/server/mobile typechecks.
2. Run all server tests, render-config tests, and Supabase security tests.
3. Inspect `git diff --check`, `git status`, and the complete diff for unrelated changes or secrets.
4. Report changed files, verification evidence, production migration not applied, and remaining hardware/native E2E coverage.
