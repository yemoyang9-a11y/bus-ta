import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECURITY_BASELINE = "20260804112643_secure_data_api_access.sql";
const SERVER_ONLY_TABLES = [
  "public.trips",
  "public.trip_status",
  "public.location_logs",
  "public.bell_logs",
  "public.bus_beacons",
];
const OBJECT_PRIVILEGES = {
  tables: [
    "select",
    "insert",
    "update",
    "delete",
    "truncate",
    "references",
    "trigger",
    "maintain",
  ],
  functions: ["execute"],
  sequences: ["usage", "select", "update"],
};
const SERVICE_ROLE_TABLE_CRUD_PRIVILEGES = ["select", "insert", "update", "delete"];
const SERVICE_ROLE_TABLE_NON_DML_PRIVILEGES = [
  "truncate",
  "references",
  "trigger",
  "maintain",
];

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let dollarTag = null;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const nextCharacter = sql[index + 1];

    if (inLineComment) {
      if (character === "\n") {
        current += character;
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        index += 1;
        inBlockComment = false;
      } else if (character === "\n") {
        current += character;
      }
      continue;
    }

    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += character;
      }
      continue;
    }

    if (inSingleQuote) {
      current += character;
      if (character === "'" && nextCharacter === "'") {
        current += nextCharacter;
        index += 1;
      } else if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += character;
      if (character === '"' && nextCharacter === '"') {
        current += nextCharacter;
        index += 1;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (character === "-" && nextCharacter === "-") {
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'") {
      current += character;
      inSingleQuote = true;
      continue;
    }

    if (character === '"') {
      current += character;
      inDoubleQuote = true;
      continue;
    }

    if (character === "$") {
      const tagMatch = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        dollarTag = tagMatch[0];
        current += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }

    if (character === ";") {
      if (current.trim().length > 0) {
        statements.push(current.trim());
      }
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim().length > 0) {
    statements.push(current.trim());
  }

  return statements;
}

function normalizeSql(sql) {
  return sql.toLowerCase().replace(/\s+/g, " ").trim();
}

function splitNames(value) {
  return new Set(
    value
      .replace(/\bwith grant option\b/g, "")
      .replace(/\b(?:cascade|restrict)\b/g, "")
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function parsePrivileges(value, objectType) {
  const privileges = splitNames(value.replace(/\bprivileges\b/g, ""));
  return privileges.has("all") ? new Set(OBJECT_PRIVILEGES[objectType]) : privileges;
}

function includesPrivileges(granted, required) {
  return granted.has("all") || required.every((privilege) => granted.has(privilege));
}

export function inspectMigrationSql(sql) {
  const issues = [];

  for (const statement of splitSqlStatements(sql)) {
    const normalizedStatement = normalizeSql(statement);
    const functionMatch = normalizedStatement.match(
      /^create\s+(?:or\s+replace\s+)?function\s+([^\s(]+)/,
    );

    if (!functionMatch || !functionMatch[1].startsWith("public.")) {
      continue;
    }

    const bodyStart = statement.search(/\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
    const header = normalizeSql(bodyStart === -1 ? statement : statement.slice(0, bodyStart));
    const functionName = functionMatch[1];

    if (!/\bsecurity\s+invoker\b/.test(header)) {
      issues.push(`${functionName}: SECURITY INVOKER is required`);
    }

    if (!/\bset\s+search_path\s*(?:=|to)\s*''/.test(header)) {
      issues.push(`${functionName}: SET search_path = '' is required`);
    }
  }

  return issues;
}

export function inspectDefaultPrivilegePosture(files) {
  const revokedDefaultPrivileges = {
    tables: new Map(),
    functions: new Map(),
    sequences: new Map(),
  };
  const revokedTablePrivileges = new Map();
  const grantedTablePrivileges = new Map();
  const explicitGrantedTablePrivileges = new Map();

  for (const file of files) {
    for (const statement of splitSqlStatements(file.sql)) {
      const normalizedStatement = normalizeSql(statement);
      const defaultPrivilegeMatch = normalizedStatement.match(
        /^alter default privileges for role postgres in schema public (grant|revoke) (.+?) on (tables|functions|routines|sequences) (?:to|from) (.+)$/,
      );

      if (defaultPrivilegeMatch) {
        const action = defaultPrivilegeMatch[1];
        const objectType = defaultPrivilegeMatch[3] === "routines" ? "functions" : defaultPrivilegeMatch[3];
        const privileges = parsePrivileges(defaultPrivilegeMatch[2], objectType);
        const roles = splitNames(defaultPrivilegeMatch[4]);

        for (const role of roles) {
          const rolePrivileges = revokedDefaultPrivileges[objectType].get(role) ?? new Set();
          for (const privilege of privileges) {
            if (action === "revoke") {
              rolePrivileges.add(privilege);
            } else {
              rolePrivileges.delete(privilege);
            }
          }
          revokedDefaultPrivileges[objectType].set(role, rolePrivileges);
        }
      }

      const tablePrivilegeMatch = normalizedStatement.match(
        /^(grant|revoke) (.+?) on table (.+?) (?:to|from) (.+)$/,
      );
      if (tablePrivilegeMatch) {
        const action = tablePrivilegeMatch[1];
        const privileges = parsePrivileges(tablePrivilegeMatch[2], "tables");
        const explicitPrivileges = splitNames(
          tablePrivilegeMatch[2].replace(/\bprivileges\b/g, ""),
        );
        const tables = splitNames(tablePrivilegeMatch[3]);
        const roles = splitNames(tablePrivilegeMatch[4]);

        for (const role of roles) {
          for (const table of tables) {
            const key = `${role}:${table}`;
            const revokedPrivileges = revokedTablePrivileges.get(key) ?? new Set();
            const grantedPrivileges = grantedTablePrivileges.get(key) ?? new Set();
            const explicitGrantedPrivileges =
              explicitGrantedTablePrivileges.get(key) ?? new Set();
            for (const privilege of privileges) {
              if (action === "revoke") {
                revokedPrivileges.add(privilege);
                grantedPrivileges.delete(privilege);
              } else {
                revokedPrivileges.delete(privilege);
                grantedPrivileges.add(privilege);
              }
            }

            if (action === "revoke") {
              if (explicitPrivileges.has("all")) {
                explicitGrantedPrivileges.clear();
              } else {
                for (const privilege of explicitPrivileges) {
                  explicitGrantedPrivileges.delete(privilege);
                }
              }
            } else if (explicitPrivileges.has("all")) {
              explicitGrantedPrivileges.add("all");
            } else {
              for (const privilege of explicitPrivileges) {
                explicitGrantedPrivileges.add(privilege);
              }
            }

            revokedTablePrivileges.set(key, revokedPrivileges);
            grantedTablePrivileges.set(key, grantedPrivileges);
            explicitGrantedTablePrivileges.set(key, explicitGrantedPrivileges);
          }
        }
      }
    }
  }

  const issues = [];
  const dataApiRoles = ["anon", "authenticated", "service_role"];
  const hasDefaultPrivileges = (objectType, roles, privileges) =>
    roles.every((role) =>
      includesPrivileges(
        revokedDefaultPrivileges[objectType].get(role) ?? new Set(),
        privileges,
      ),
    );

  if (!hasDefaultPrivileges("tables", dataApiRoles, ["select", "insert", "update", "delete"])) {
    issues.push(
      "missing default table privilege revocation for anon, authenticated, service_role",
    );
  }

  if (!hasDefaultPrivileges("functions", dataApiRoles, ["execute"])) {
    issues.push(
      "missing default function EXECUTE revocation for anon, authenticated, service_role",
    );
  }

  if (!hasDefaultPrivileges("sequences", dataApiRoles, ["usage", "select"])) {
    issues.push(
      "missing default sequence privilege revocation for anon, authenticated, service_role",
    );
  }

  if (!hasDefaultPrivileges("functions", ["public"], ["execute"])) {
    issues.push("missing default function EXECUTE revocation for PUBLIC");
  }

  const hasFullTableRevocation = ["public", "anon", "authenticated"].every((role) =>
    SERVER_ONLY_TABLES.every((table) =>
      includesPrivileges(
        revokedTablePrivileges.get(`${role}:${table}`) ?? new Set(),
        OBJECT_PRIVILEGES.tables,
      ),
    ),
  );
  if (!hasFullTableRevocation) {
    issues.push(
      "missing full privilege revocation on existing server-only tables for public, anon, authenticated",
    );
  }

  const hasServiceRoleNonDmlRevocation = SERVER_ONLY_TABLES.every((table) =>
    includesPrivileges(
      revokedTablePrivileges.get(`service_role:${table}`) ?? new Set(),
      SERVICE_ROLE_TABLE_NON_DML_PRIVILEGES,
    ),
  );
  if (!hasServiceRoleNonDmlRevocation) {
    issues.push(
      "missing service_role non-DML privilege revocation on existing server-only tables",
    );
  }

  const hasServiceRoleExplicitCrudGrant = SERVER_ONLY_TABLES.every((table) => {
    const grantedPrivileges = grantedTablePrivileges.get(`service_role:${table}`) ?? new Set();
    const explicitGrantedPrivileges =
      explicitGrantedTablePrivileges.get(`service_role:${table}`) ?? new Set();

    return (
      grantedPrivileges.size === SERVICE_ROLE_TABLE_CRUD_PRIVILEGES.length &&
      SERVICE_ROLE_TABLE_CRUD_PRIVILEGES.every((privilege) => grantedPrivileges.has(privilege)) &&
      explicitGrantedPrivileges.size === SERVICE_ROLE_TABLE_CRUD_PRIVILEGES.length &&
      SERVICE_ROLE_TABLE_CRUD_PRIVILEGES.every((privilege) => explicitGrantedPrivileges.has(privilege))
    );
  });
  if (!hasServiceRoleExplicitCrudGrant) {
    issues.push(
      "missing explicit CRUD grant for service_role on existing server-only tables",
    );
  }

  return issues;
}

export async function validateMigrationDirectory(migrationDirectory) {
  const names = (await fs.readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      sql: await fs.readFile(path.join(migrationDirectory, name), "utf8"),
    })),
  );
  const issues = inspectDefaultPrivilegePosture(files);

  for (const file of files.filter((entry) => entry.name > SECURITY_BASELINE)) {
    for (const issue of inspectMigrationSql(file.sql)) {
      issues.push(`${file.name}: ${issue}`);
    }
  }

  return issues;
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationDirectory = path.resolve(scriptDirectory, "../supabase/migrations");
  const issues = await validateMigrationDirectory(migrationDirectory);

  if (issues.length === 0) {
    console.log("Supabase security verification passed.");
    return;
  }

  console.error("Supabase security verification failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
