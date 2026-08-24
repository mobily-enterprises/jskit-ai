import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("database-runtime-mysql owns its driver while CI remains app-owned source", async () => {
  const workflow = await readFile(
    path.join(PACKAGE_ROOT, "patterns/mysql-application/example/.github/workflows/verify.yml"),
    "utf8"
  );

  assert.equal(packageJson.dependencies.mysql2, "^3.11.2");
  assert.equal(Object.hasOwn(packageJson.jskit, "options"), false);
  assert.equal(Object.hasOwn(packageJson.jskit, "mutations"), false);
  assert.equal(Object.hasOwn(packageJson.jskit, "ci"), false);
  assert.match(workflow, /image: mariadb:11\.4/u);
  assert.match(workflow, /npm run db:migrate/u);
  assert.match(workflow, /npm run verify/u);
});
