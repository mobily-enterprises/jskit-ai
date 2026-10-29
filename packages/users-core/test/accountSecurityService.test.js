import test from "node:test";
import assert from "node:assert/strict";
import { buildSecurityStatusFromAuthMethodsStatus } from "@jskit-ai/auth-core/shared/authSecurityStatus";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { createService } from "../src/server/accountSecurity/accountSecurityService.js";
import { userSettingsResource } from "../src/shared/resources/userSettingsResource.js";

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

test("unlinking returns the security status in the settings output contract", async () => {
  // What an auth provider returns: auth-core's status, without settings-only fields.
  const securityStatus = buildSecurityStatusFromAuthMethodsStatus({
    methods: [
      { id: "password", kind: "password", provider: "email", label: "Password", configured: true, enabled: true },
      { id: "oauth:github", kind: "oauth", provider: "github", label: "GitHub", configured: false, enabled: false, canEnable: true }
    ]
  });
  const outputOf = (value) => validateOperationSection({
    operation: userSettingsResource.operations.oauthUnlink,
    section: "output",
    value
  });
  assert.equal(outputOf({ securityStatus }).ok, false);

  const service = createService({
    userSettingsRepository: {},
    userProfilesRepository: {},
    authService: {
      async unlinkProvider(_request, { provider }) {
        assert.equal(provider, "github");
        return { securityStatus };
      }
    }
  });
  const result = await service.unlinkOAuthProvider({}, { id: "user-1" }, { provider: "github" });
  const output = outputOf(result.value);
  assert.equal(output.ok, true, JSON.stringify(output.fieldErrors));
  assert.equal(result.value.securityStatus.authMethods[1].canEnable, true);
});
