import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  hashPassword as localHashPassword,
  verifyPassword as localVerifyPassword
} from "@jskit-ai/auth-provider-local-core/server/lib/index";
import { hashPassword, verifyPassword } from "../src/server/crypto.js";

test("hub and JSKIT local accounts accept each other's scrypt v1 passwords", async () => {
  const fromLocal = await localHashPassword("shared passphrase");
  assert.equal(await verifyPassword("shared passphrase", fromLocal), true);
  assert.equal(await verifyPassword("other passphrase", fromLocal), false);
  const fromHub = await hashPassword("shared passphrase");
  assert.deepEqual(Object.keys(fromHub).sort(), Object.keys(fromLocal).sort());
  assert.equal(fromHub.algorithm, fromLocal.algorithm);
  assert.equal(fromHub.version, fromLocal.version);
  assert.equal(await localVerifyPassword("shared passphrase", fromHub), true);
});

test("the published package carries the common-password list the hub reads", () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8"
  }));
  const files = pack.files.map(({ path }) => path);
  assert.ok(files.includes("data/common-passwords.txt"), files.join(", "));
  assert.ok(files.includes("migrations/oidc_issuer_initial.cjs"));
});
