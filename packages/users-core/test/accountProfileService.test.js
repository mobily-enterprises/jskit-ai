import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/accountProfile/accountProfileService.js";

test("profile updates use the auth provider's display-name input contract", async () => {
  const request = { cookies: {} };
  const profile = { id: 7, displayName: "Before", email: "profile@example.test" };
  let updated = false;
  const service = createService({
    userProfilesRepository: { async findById() { return profile; } },
    userSettingsRepository: { async ensureForUserId(id) { assert.equal(id, 7); return {}; } },
    avatarService: {},
    authService: {
      async updateDisplayName(actualRequest, input) {
        assert.equal(actualRequest, request);
        assert.deepEqual(input, { displayName: "After" });
        updated = true;
        return { profile: { ...profile, displayName: input.displayName }, session: null };
      }
    }
  });
  await service.updateProfile(request, { id: 7 }, { displayName: "After" });
  assert.equal(updated, true);
});
