import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/accountSecurity/accountSecurityService.js";

test("account security service returns explicit logout result for other sessions", async () => {
  const calls = [];
  const authService = {
    async signOutOtherSessions(request) {
      calls.push(request);
      return {
        ok: true
      };
    }
  };

  const service = createService({
    userSettingsRepository: {},
    userProfilesRepository: {},
    authService
  });

  const request = {
    id: "request-1"
  };

  const result = await service.logoutOtherSessions(request, {
    id: "user-1"
  });

  assert.deepEqual(result, {
    ok: true
  });
  assert.deepEqual(calls, [request]);
});
