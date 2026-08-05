import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepositoryFile(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("Render Blueprint defines the production server and secret names", () => {
  const renderYaml = readRepositoryFile("render.yaml");
  const requiredSecretNames = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "KAKAO_REST_API_KEY",
    "ODSAY_API_KEY",
    "GBIS_SERVICE_KEY",
    "OPENAI_API_KEY",
    "REALTIME_SHARED_SECRET",
  ];

  assert.match(renderYaml, /services:\s*\n\s*- type: web/);
  assert.match(renderYaml, /^\s*name:\s*bus-ta\s*$/m);
  assert.match(renderYaml, /\bruntime:\s*node\b/);
  assert.match(renderYaml, /\bregion:\s*singapore\b/);
  assert.match(renderYaml, /\bbranch:\s*yemo-develop\b/);
  assert.match(
    renderYaml,
    /buildCommand:\s*corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm --filter @bus-ta\/server build/,
  );
  assert.match(renderYaml, /startCommand:\s*pnpm --filter @bus-ta\/server start/);
  assert.match(renderYaml, /healthCheckPath:\s*\/api\/health/);
  assert.match(renderYaml, /- key:\s*NODE_VERSION\s*\n\s*value:\s*22\.17\.0/);
  assert.match(
    renderYaml,
    /- key:\s*COREPACK_ENABLE_DOWNLOAD_PROMPT\s*\n\s*value:\s*["']?0["']?/,
  );

  for (const secretName of requiredSecretNames) {
    assert.match(
      renderYaml,
      new RegExp(`- key:\\s*${secretName}\\s*\\n\\s*sync:\\s*false`),
      `${secretName} must be configured as a Render secret name only`,
    );
  }

  assert.doesNotMatch(renderYaml, /- key:\s*SUPABASE_ANON_KEY\b/);
});

test("server production start uses the runtime TypeScript loader", () => {
  const serverPackage = JSON.parse(readRepositoryFile("apps/server/package.json"));

  assert.equal(serverPackage.scripts.start, "tsx src/index.ts");
  assert.ok(serverPackage.dependencies?.tsx, "tsx must be installed for production start");
  assert.equal(serverPackage.devDependencies?.tsx, undefined);
});

test("README documents the Render deployment entry point and health gate", () => {
  const readme = readRepositoryFile("README.md");

  assert.match(readme, /`render\.yaml`/);
  assert.match(readme, /`yemo-develop`/);
  assert.match(readme, /`bus-ta`/);
  assert.match(readme, /secret[- ]name[- ]only|비밀값.*이름/iu);
  assert.match(readme, /HTTP 200/);
  assert.match(readme, /serverStatus:\s*UP/);
  assert.match(readme, /dbStatus:\s*UP/);
});
