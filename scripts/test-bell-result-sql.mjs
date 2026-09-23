// Requires all migrations applied to an isolated local PostgreSQL database.
// PSQL_BIN can point to psql.exe on Windows. SQL travels over UTF-8 stdin.
// This is an actual multi-session lock test, not a simulated request race.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const host = process.env.PGHOST ?? "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error("This fixture runner only accepts a local PostgreSQL host");
}
const psql = process.env.PSQL_BIN ?? "psql";
const database = process.env.PGDATABASE ?? "postgres";
const baseEnv = {
  ...process.env, PGHOST: host, PGPORT: process.env.PGPORT ?? "5432",
  PGUSER: process.env.PGUSER ?? "postgres", PGCLIENTENCODING: "UTF8",
};
const sessions = new Set();

function session(applicationName, sql, keepOpen = false) {
  const child = spawn(psql, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database], {
    env: { ...baseEnv, PGAPPNAME: applicationName }, windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  sessions.add(child);
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (data) => { stdout += data; });
  child.stderr.setEncoding("utf8").on("data", (data) => { stderr += data; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      sessions.delete(child);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${applicationName} exited ${code}: ${stderr}`));
    });
  });
  // Observe rejections immediately; each caller still awaits the original promise.
  void done.catch(() => {});
  child.stdin.on("error", () => {});
  child.stdin.write("set statement_timeout='15s'; set lock_timeout='10s';\n" + sql, "utf8");
  if (!keepOpen) child.stdin.end();
  return { child, done, output: () => stdout };
}
async function run(sql) { return session("t3-bell-sql-observer", sql).done; }
function objectFrom(output) {
  const line = output.split(/\r?\n/).find((item) => item.startsWith("{"));
  assert.ok(line, `expected JSON RPC output: ${output}`);
  return JSON.parse(line);
}
async function waitUntil(predicate, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

await run(await readFile(new URL("../supabase/tests/bell_result_atomicity.sql", import.meta.url), "utf8"));
console.log("PASS: transactional SQL, rollback injection, retries, legacy repair and ACL");

const fixtures = [];
try {
  for (const scenario of ["same", "conflicting", "cancel-first", "result-first"]) {
    const id = `t3-race-${randomUUID()}`;
    fixtures.push(id);
    const bellId = `bell-${id}`;
    await run(`
      insert into public.trips (trip_id,destination,candidate_id,route_no,local_bus_id,gbis_station_id,boarding_station,destination_station,station_list)
      values ('${id}','fixture',1,'T3','fixture','fixture','{}','{}','[{},{}]');
      insert into public.trip_status (trip_id,remaining_stations,trip_status,bell_status,boarding_method,boarding_confirmed_at,boarding_request_id)
      values ('${id}',1,'NEAR_DESTINATION','PENDING','USER_CONFIRMED','2026-09-22T09:00:00Z','fixture');
      insert into public.bell_logs (trip_id,bell_request_id) values ('${id}','${bellId}');
    `);
    const record = (result) => `select public.record_bell_result('${id}','${bellId}','${result}','first-${result}',false,'2026-09-22T09:00:01Z');`;
    const cancel = `select public.cancel_trip('${id}','2026-09-22T09:00:02Z');`;
    const firstSql = scenario === "cancel-first" ? cancel : record("SUCCESS");
    const secondSql = scenario === "result-first" ? cancel : record(scenario === "conflicting" ? "FAIL" : "SUCCESS");
    const first = session(`${id}-first`, `begin; set local role service_role; ${firstSql}\n\\echo T3_LOCK_HELD\n`, true);
    await waitUntil(() => first.output().includes("T3_LOCK_HELD"), "first transaction to hold the row lock");
    const second = session(`${id}-second`, `begin; set local role service_role; ${secondSql} commit;\n`);
    await waitUntil(async () => (await run(`select count(*) from pg_stat_activity where application_name='${id}-second' and wait_event_type='Lock';`)).trim() === "1", "separate competing session to block on the lock");
    assert.equal(second.output().trim(), "", "contender must not finish before the winner commits");
    first.child.stdin.end("commit;\n");
    const [firstOutput, secondOutput] = await Promise.all([first.done, second.done]);
    const persisted = objectFrom(await run(`select jsonb_build_object('tripStatus',s.trip_status,'bellStatus',s.bell_status,'result',b.result,'message',b.message) from public.trip_status s join public.bell_logs b using(trip_id) where s.trip_id='${id}';`));
    assert.equal(persisted.bellStatus, "SUCCESS");
    assert.equal(persisted.result, "SUCCESS");
    assert.equal(persisted.message, "first-SUCCESS");
    if (scenario === "cancel-first") {
      assert.match(firstOutput, /CANCELLED/);
      assert.equal(objectFrom(secondOutput).tripStatus, "CANCELLED");
      assert.equal(persisted.tripStatus, "CANCELLED");
    } else if (scenario === "result-first") {
      assert.equal(objectFrom(firstOutput).tripStatus, "NEAR_DESTINATION");
      assert.match(secondOutput, /CANCELLED/);
      assert.equal(persisted.tripStatus, "CANCELLED");
    } else {
      assert.equal(objectFrom(firstOutput).outcome, "SAVED");
      assert.equal(objectFrom(secondOutput).outcome, "ALREADY_RECORDED");
      assert.equal(objectFrom(secondOutput).bellStatus, "SUCCESS");
      assert.equal(persisted.tripStatus, "NEAR_DESTINATION");
    }
    console.log(`PASS: ${scenario} (two PostgreSQL sessions; lock wait observed before commit)`);
  }
} finally {
  const active = [...sessions];
  for (const child of active) child.stdin.end("rollback;\n");
  // A blocked contender ends once its lock holder disconnects or rolls back.
  await waitUntil(() => sessions.size === 0, "test sessions to close");
  if (fixtures.length) {
    // UUIDs generated above are the complete deletion scope; never clean arbitrary rows.
    await run(`delete from public.trips where trip_id in (${fixtures.map((id) => `'${id}'`).join(",")});`);
    const count = await run(`select count(*) from public.trips where trip_id in (${fixtures.map((id) => `'${id}'`).join(",")});`);
    assert.equal(count.trim(), "0", "all task-only fixtures removed");
  }
}
console.log("PASS: all bell result SQL tests; task-only fixtures removed");
