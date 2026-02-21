import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("server bootstrap succeeds with billing disabled and no billing secrets", () => {
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      "import('./server.js').then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });"
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        BILLING_ENABLED: "false",
        BILLING_OPERATION_KEY_SECRET: "",
        BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "",
        BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: ""
      },
      encoding: "utf8"
    }
  );

  const stderr = String(child.stderr || "").trim();
  assert.equal(
    child.status,
    0,
    `Expected bootstrap import to succeed when billing is disabled.${stderr ? ` stderr: ${stderr}` : ""}`
  );
});
