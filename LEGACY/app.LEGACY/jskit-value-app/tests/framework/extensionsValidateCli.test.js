import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FRAMEWORK_TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(FRAMEWORK_TEST_DIR, "../..");
const FIXTURE_DIR = path.resolve(FRAMEWORK_TEST_DIR, "fixtures/extensions");

test("frameworkExtensionsValidate CLI succeeds for compatible extension modules", () => {
  const result = spawnSync("npm", ["run", "framework:extensions:validate", "--", "--module", path.join(FIXTURE_DIR, "sampleExtension.js")], {
    cwd: APP_ROOT,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || "frameworkExtensionsValidate CLI failed");
  assert.match(result.stdout, /framework extensions validate: ok/);
  assert.match(result.stdout, /sampleExtension/);
});

test("frameworkExtensionsValidate CLI reports strict dependency failures", () => {
  const result = spawnSync(
    "npm",
    ["run", "framework:extensions:validate", "--", "--module", path.join(FIXTURE_DIR, "brokenDependencyExtension.js")],
    {
      cwd: APP_ROOT,
      encoding: "utf8"
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /framework extensions validate: failed/);
  assert.match(result.stderr, /MODULE_DEPENDENCY_MISSING/);
});

test("frameworkExtensionsValidate CLI requires extension module paths", () => {
  const result = spawnSync("npm", ["run", "framework:extensions:validate"], {
    cwd: APP_ROOT,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /At least one extension module path must be provided/);
});
