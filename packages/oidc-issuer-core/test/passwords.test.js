import assert from "node:assert/strict";
import { test } from "node:test";
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
