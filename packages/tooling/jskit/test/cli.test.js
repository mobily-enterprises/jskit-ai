import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const JSKIT_LOCAL_DEPENDENCY_PREFIX = "file:node_modules/@jskit-ai/jskit/packages/";
const MYSQL_OPTION_ARGS = [
  "--db-host",
  "127.0.0.1",
  "--db-port",
  "3306",
  "--db-name",
  "app",
  "--db-user",
  "root",
  "--db-password",
  "secret"
];
const POSTGRES_OPTION_ARGS = [
  "--db-host",
  "127.0.0.1",
  "--db-port",
  "5432",
  "--db-name",
  "app",
  "--db-user",
  "postgres",
  "--db-password",
  "secret"
];
const SUPABASE_OPTION_ARGS = [
  "--auth-supabase-url",
  "https://example.supabase.co",
  "--auth-supabase-publishable-key",
  "sb_publishable_example"
];

function runCli({ cwd, args = [] }) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBundleSection(output, bundleId) {
  const source = String(output || "");
  const bundlePattern = new RegExp(
    `- ${escapeRegExp(bundleId)} \\([^)]+\\)[\\s\\S]*?(?=\\n- [a-z0-9-]+ \\(|\\nProvider bundles:|$)`,
    "i"
  );
  const match = source.match(bundlePattern);
  return match ? match[0] : "";
}

async function writeJsonFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-cli-"));

  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "temp-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "jskit-app-scripts start",
        server: "jskit-app-scripts server"
      },
      dependencies: {
        "@jskit-ai/app-scripts": "0.1.0",
        fastify: "^5.7.4",
        vue: "^3.5.13"
      },
      devDependencies: {
        "@jskit-ai/config-eslint": "0.1.0",
        eslint: "^9.39.1",
        vite: "^6.1.0",
        vitest: "^4.0.18"
      }
    });

    await writeFile(path.join(appRoot, "Procfile"), "web: npm run start\n", "utf8");

    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("jskit list shows built-in db bundles", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["list", "bundles"]
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /db-mysql \(0\.2\.0\)/);
    assert.match(result.stdout, /db-postgres \(0\.2\.0\)/);
  });
});

test("jskit list bundles defaults to curated list and list bundles all shows full catalog", async () => {
  await withTempApp(async (appRoot) => {
    const curated = runCli({
      cwd: appRoot,
      args: ["list", "bundles"]
    });
    assert.equal(curated.status, 0, curated.stderr);
    assert.match(curated.stdout, /db-mysql \(0\.2\.0\)/);
    assert.doesNotMatch(curated.stdout, /api-foundations \(0\.1\.0\)/);

    const allBundles = runCli({
      cwd: appRoot,
      args: ["list", "bundles", "all"]
    });
    assert.equal(allBundles.status, 0, allBundles.stderr);
    assert.match(allBundles.stdout, /api-foundations \(0\.1\.0\)/);
    assert.match(allBundles.stdout, /db-postgres \(0\.2\.0\)/);
  });
});

test("jskit list bundles --full prints package ids per bundle", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["list", "bundles", "--full"]
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /packages \(\d+\):/);
    assert.match(result.stdout, /\bdb-mysql\*/);
    assert.match(result.stdout, /\bdb-mysql\*: MySQL db-provider package/i);
    assert.doesNotMatch(result.stdout, /\bjskit-knex: Capabilities: db\.core\./i);
    assert.match(result.stdout, /\bassistant-core \[openai\]:/i);
    assert.match(result.stdout, /\* provider package/i);
  });
});

test("jskit list bundles marks bundle-level provider requirements", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["list", "bundles"]
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /assistant \(0\.1\.0\).* \[[^\]]*openai[^\]]*\]:/i);
  });
});

test("jskit list bundles all marks db-provider requirement hints", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["list", "bundles", "all"]
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /chat-base \(0\.1\.0\).* \[[^\]]*db-provider[^\]]*\]:/i);
    assert.doesNotMatch(result.stdout, /chat-base \(0\.1\.0\).* \[[^\]]*supabase[^\]]*\]:/i);
  });
});

test("jskit show <id> resolves bundle ids", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["show", "db-mysql"]
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bundle db-mysql \(0\.2\.0\)/);
    assert.match(result.stdout, /Packages \(1\):/);
    assert.match(result.stdout, /\bdb-mysql\b/);
    assert.doesNotMatch(result.stdout, /@jskit-ai\/db-mysql/);
    assert.doesNotMatch(result.stdout, /@jskit-ai\/jskit-knex/);
    assert.doesNotMatch(result.stdout, /@jskit-ai\/jskit-knex-mysql/);
  });
});

test("jskit list bundles --full shows declared packages unless --expanded is set", async () => {
  await withTempApp(async (appRoot) => {
    const declared = runCli({
      cwd: appRoot,
      args: ["list", "bundles", "all", "--full"]
    });
    assert.equal(declared.status, 0, declared.stderr);
    const declaredBillingBase = extractBundleSection(declared.stdout, "billing-base");
    assert.match(declaredBillingBase, /packages \(10\):/i);
    assert.doesNotMatch(declaredBillingBase, /\bmodule-framework-core\b/i);

    const expanded = runCli({
      cwd: appRoot,
      args: ["list", "bundles", "all", "--full", "--expanded"]
    });
    assert.equal(expanded.status, 0, expanded.stderr);
    const expandedBillingBase = extractBundleSection(expanded.stdout, "billing-base");
    assert.match(expandedBillingBase, /packages \((?:1[1-9]|[2-9]\d)\):/i);
    assert.match(expandedBillingBase, /\bmodule-framework-core\b/i);
  });
});

test("jskit show <id> defaults to declared packages and supports --expanded", async () => {
  await withTempApp(async (appRoot) => {
    const declared = runCli({
      cwd: appRoot,
      args: ["show", "billing-base"]
    });
    assert.equal(declared.status, 0, declared.stderr);
    assert.match(declared.stdout, /Packages \(10\):/);
    assert.doesNotMatch(declared.stdout, /@jskit-ai\/module-framework-core/i);

    const expanded = runCli({
      cwd: appRoot,
      args: ["show", "billing-base", "--expanded"]
    });
    assert.equal(expanded.status, 0, expanded.stderr);
    assert.match(expanded.stdout, /Packages \((?:1[1-9]|[2-9]\d)\) \[expanded\]:/i);
    assert.match(expanded.stdout, /\bmodule-framework-core\b/i);
    assert.doesNotMatch(expanded.stdout, /@jskit-ai\/module-framework-core/i);
  });
});

test("jskit show <id> prints grouped capabilities and routes for bundle ids", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["show", "social-base"]
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bundle social-base \(0\.1\.0\)/);
    assert.match(result.stdout, /Type: bundle shortcut/);
    assert.match(result.stdout, /Requires capabilities:/);
    assert.match(result.stdout, /contracts \(http, social\)/i);
    assert.match(result.stdout, /db \(core\)/i);
    assert.match(result.stdout, /Contracts:/);
    assert.match(result.stdout, /social\.server-routes/i);
    assert.match(result.stdout, /Server routes \(\d+\):/);
    assert.match(result.stdout, /GET \/api\/workspace\/social\/feed/);
  });
});

test("jskit show <id> resolves package ids", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["show", "@jskit-ai/social-fastify-routes"]
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Package social-fastify-routes \(0\.1\.0\)/);
    assert.doesNotMatch(result.stdout, /Package @jskit-ai\/social-fastify-routes \(0\.1\.0\)/);
    assert.match(result.stdout, /Type: package/);
    assert.match(result.stdout, /Provides capabilities:/);
    assert.match(result.stdout, /social \(server-routes\)/i);
    assert.match(result.stdout, /Server routes \(\d+\):/);
    assert.match(result.stdout, /DELETE \/api\/workspace\/social\/posts\/:postId/);
  });
});

test("jskit show <id> resolves short package ids", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["show", "social-fastify-routes"]
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Package social-fastify-routes \(0\.1\.0\)/);
    assert.match(result.stdout, /Type: package/);
  });
});

test("jskit view <id> is an alias of show <id>", async () => {
  await withTempApp(async (appRoot) => {
    const showResult = runCli({
      cwd: appRoot,
      args: ["show", "social-base"]
    });
    const viewResult = runCli({
      cwd: appRoot,
      args: ["view", "social-base"]
    });

    assert.equal(showResult.status, 0, showResult.stderr);
    assert.equal(viewResult.status, 0, viewResult.stderr);
    assert.equal(viewResult.stdout, showResult.stdout);
  });
});

test("jskit show rejects legacy scoped syntax", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["show", "bundle", "db-mysql"]
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /jskit show usage: show <id>/i);
  });
});

test("jskit add package accepts short package ids", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "module-framework-core", "--no-install"]
    });
    assert.equal(addResult.status, 0, addResult.stderr);
    assert.match(addResult.stdout, /Added package @jskit-ai\/module-framework-core/);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.ok(lock.installedPackages["@jskit-ai/module-framework-core"]);
  });
});

test("jskit add bundle db-mysql applies package-owned mutations", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
    });

    assert.equal(addResult.status, 0, addResult.stderr);
    assert.match(addResult.stdout, /Added bundle db-mysql/);
    assert.match(addResult.stdout, /Resolved packages \(3\)/);
    assert.match(addResult.stdout, /db-mysql/);
    assert.match(addResult.stdout, /jskit-knex/);
    assert.match(addResult.stdout, /jskit-knex-mysql/);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(
      packageJson.dependencies.knex,
      "https://codeload.github.com/knex/knex/tar.gz/c18fb1ba2dc3001ee0fb2a79c126a32e6cd831a5"
    );
    assert.equal(packageJson.dependencies.mysql2, "^3.15.3");
    assert.equal(packageJson.scripts["db:migrate"], "jskit-app-scripts db:migrate");

    const procfile = await readFile(path.join(appRoot, "Procfile"), "utf8");
    assert.match(procfile, /^release: npm run db:migrate$/m);
    assert.match(procfile, /^web: npm run start$/m);
    const envFile = await readFile(path.join(appRoot, ".env"), "utf8");
    assert.match(envFile, /^DB_CLIENT=mysql2$/m);
    assert.match(envFile, /^DB_HOST=127\.0\.0\.1$/m);
    assert.match(envFile, /^DB_PORT=3306$/m);
    assert.match(envFile, /^DB_NAME=app$/m);
    assert.match(envFile, /^DB_USER=root$/m);
    assert.match(envFile, /^DB_PASSWORD=secret$/m);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.equal(lock.lockVersion, 3);
    assert.ok(lock.installedPackages["@jskit-ai/db-mysql"]);

    const doctor = runCli({ cwd: appRoot, args: ["doctor"] });
    assert.equal(doctor.status, 0, doctor.stderr);
  });
});

test("jskit add bundle db-postgres applies postgres dependency", async () => {
  await withTempApp(async (appRoot) => {
    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-postgres", "--no-install", ...POSTGRES_OPTION_ARGS]
    });

    assert.equal(addResult.status, 0, addResult.stderr);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    assert.equal(packageJson.dependencies.pg, "^8.16.3");
    assert.equal(packageJson.dependencies.mysql2, undefined);

    const knexfile = await readFile(path.join(appRoot, "knexfile.cjs"), "utf8");
    assert.match(knexfile, /const KNEX_CLIENT = "pg"/);
  });
});

test("jskit bundle requiring capability fails with provider suggestions", async () => {
  await withTempApp(async (appRoot) => {
    const missingProvider = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "security-audit", "--no-install"]
    });
    assert.notEqual(missingProvider.status, 0);
    assert.match(missingProvider.stderr, /\[capability-violation\]/);
    assert.match(missingProvider.stderr, /db-provider/i);
    assert.match(missingProvider.stderr, /jskit add bundle db-mysql/);
    assert.match(missingProvider.stderr, /jskit add bundle db-postgres/);
  });
});

test("adding db-postgres on top of db-mysql fails due managed file drift", async () => {
  await withTempApp(async (appRoot) => {
    const addDbMySql = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
    });
    assert.equal(addDbMySql.status, 0, addDbMySql.stderr);

    const addSecurityAudit = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "security-audit", "--no-install"]
    });
    assert.equal(addSecurityAudit.status, 0, addSecurityAudit.stderr);

    const addDbPostgres = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-postgres", "--no-install", ...POSTGRES_OPTION_ARGS]
    });
    assert.notEqual(addDbPostgres.status, 0);
    assert.match(addDbPostgres.stderr, /\[managed-file-drift\]/i);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.ok(lock.installedPackages["@jskit-ai/db-mysql"]);
    assert.equal(lock.installedPackages["@jskit-ai/db-postgres"], undefined);
  });
});

test("legacy pack command syntax is rejected", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["add", "db", "--no-install"]
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires a scope and id/i);
  });
});

test("bundle update/remove commands are rejected", async () => {
  await withTempApp(async (appRoot) => {
    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "bundle", "db-mysql", "--no-install"]
    });
    assert.notEqual(updateResult.status, 0);
    assert.match(updateResult.stderr, /update supports only package scope/i);

    const removeResult = runCli({
      cwd: appRoot,
      args: ["remove", "bundle", "db-mysql"]
    });
    assert.notEqual(removeResult.status, 0);
    assert.match(removeResult.stderr, /remove supports only package scope/i);
  });
});

test("doctor reports missing managed file drift", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    await rm(path.join(appRoot, "knexfile.cjs"), { force: true });

    const doctor = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /Managed file missing: knexfile\.cjs/);
  });
});

test("bundle add rewrites internal JSKIT dependencies to local file specs", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const addAuthProvider = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "auth-supabase", "--no-install", ...SUPABASE_OPTION_ARGS]
    });
    assert.equal(addAuthProvider.status, 0, addAuthProvider.stderr);

    const addChat = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "chat-base", "--no-install"]
    });
    assert.equal(addChat.status, 0, addChat.stderr);

    const packageJson = await readJsonFile(path.join(appRoot, "package.json"));
    const dependencyEntries = Object.entries(packageJson.dependencies || {}).filter(([dependencyName]) =>
      dependencyName.startsWith("@jskit-ai/")
    );

    let checkedCount = 0;
    for (const [dependencyName, dependencySpec] of dependencyEntries) {
      if (dependencyName === "@jskit-ai/app-scripts") {
        continue;
      }
      checkedCount += 1;
      assert.ok(
        String(dependencySpec).startsWith(JSKIT_LOCAL_DEPENDENCY_PREFIX),
        `Expected ${dependencyName} to be rewritten to local file spec, found ${dependencySpec}.`
      );
    }

    assert.ok(checkedCount > 0, "Expected at least one internal JSKIT dependency to be rewritten.");

    const doctor = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.equal(doctor.status, 0, doctor.stderr);
  });
});

test("doctor reports distribution-policy drift for internal dependency specs", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const addAuthProvider = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "auth-supabase", "--no-install", ...SUPABASE_OPTION_ARGS]
    });
    assert.equal(addAuthProvider.status, 0, addAuthProvider.stderr);

    const addChat = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "chat-base", "--no-install"]
    });
    assert.equal(addChat.status, 0, addChat.stderr);

    const packageJsonPath = path.join(appRoot, "package.json");
    const packageJson = await readJsonFile(packageJsonPath);
    packageJson.dependencies["@jskit-ai/jskit-knex"] = "0.1.0";
    await writeJsonFile(packageJsonPath, packageJson);

    const doctor = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.notEqual(doctor.status, 0);
    assert.match(doctor.stdout, /\[distribution-policy\]/);
    assert.match(doctor.stdout, /dependencies\.\@jskit-ai\/jskit-knex/);
  });
});

test("remove package fails when removal leaves required provider capability unresolved", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const removeDb = runCli({
      cwd: appRoot,
      args: ["remove", "package", "@jskit-ai/db-mysql"]
    });
    assert.notEqual(removeDb.status, 0);
    assert.match(removeDb.stderr, /\[capability-violation\]/);
    assert.match(removeDb.stderr, /db-provider/i);

    await access(path.join(appRoot, ".jskit/lock.json"));
  });
});

test("jskit resolves app root when command is run from a nested directory", async () => {
  await withTempApp(async (appRoot) => {
    const nestedDirectory = path.join(appRoot, "server", "modules");
    await mkdir(nestedDirectory, { recursive: true });

    const addDb = runCli({
      cwd: nestedDirectory,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const lock = await readJsonFile(path.join(appRoot, ".jskit/lock.json"));
    assert.ok(lock.installedPackages["@jskit-ai/db-mysql"]);

    const listFromNested = runCli({
      cwd: nestedDirectory,
      args: ["list", "bundles"]
    });
    assert.equal(listFromNested.status, 0, listFromNested.stderr);
    assert.match(listFromNested.stdout, /db-mysql \(0\.2\.0\).* \(installed\)/i);
  });
});
