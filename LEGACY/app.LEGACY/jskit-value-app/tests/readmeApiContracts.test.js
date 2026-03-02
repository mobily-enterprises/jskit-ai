import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("README API contracts inventory matches route surface", () => {
  const result = spawnSync("npm", ["run", "docs:api-contracts:check"], {
    cwd: APP_ROOT,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || "docs:api-contracts:check failed");
});
