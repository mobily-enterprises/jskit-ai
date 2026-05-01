import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/accountSecurity/accountSecurityService.js";

test("account security service returns no content result for other sessions", async () => {
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

  assert.equal(result, null);
  assert.deepEqual(calls, [request]);
});
