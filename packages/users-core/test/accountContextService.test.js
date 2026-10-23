import test from "node:test";
import assert from "node:assert/strict";
import { resolveSecurityStatus } from "../src/server/common/services/accountContextService.js";

function authServiceWith(securityStatus) {
  return {
    getCapabilities: () => ({ features: { securityStatus } }),
    async getSecurityStatus() {
      if (!securityStatus) {
        throw new Error("unsupported");
      }
      return { mfa: { status: "not_enabled" } };
    }
  };
}

test("security status comes from a provider that supports it", async () => {
  assert.deepEqual(await resolveSecurityStatus(authServiceWith(true), {}), { mfa: { status: "not_enabled" } });
});

test("a provider without security status, such as an accounts hub, leaves it empty", async () => {
  assert.deepEqual(await resolveSecurityStatus(authServiceWith(false), {}), {});
});
