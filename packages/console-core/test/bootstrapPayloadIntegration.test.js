import assert from "node:assert/strict";
import test from "node:test";
import { createContainer } from "../../kernel/server/container/index.js";
import { resolveBootstrapPayload } from "../../kernel/server/registries/bootstrapPayloadContributorRegistry.js";
import { registerUsersBootstrap } from "../../users-core/src/server/registerUsersBootstrap.js";
import { registerConsoleBootstrap } from "../src/server/registerConsoleBootstrap.js";

function createAuthenticatedProfile(overrides = {}) {
  return {
    id: "12",
    authProvider: "local",
    authProviderUserSid: "user-12",
    username: "consoleowner",
    displayName: "Console Owner",
    email: "owner@example.com",
    ...overrides
  };
}

test("bootstrap payload preserves consoleowner for authenticated users after users bootstrap runs", async () => {
  const profile = createAuthenticatedProfile();
  const ownerSeeds = [];
  const app = createContainer();

  app.instance("internal.repository.user-profiles", {
    async findById(userId) {
      return String(userId || "") === profile.id ? profile : null;
    }
  });
  app.instance("internal.repository.user-settings", {
    async ensureForUserId() {
      return {};
    }
  });
  app.instance("authService", {
    getOAuthProviderCatalog() {
      return {
        providers: [],
        defaultProvider: null
      };
    },
    writeSessionCookies() {},
    clearSessionCookies() {}
  });
  app.instance("consoleService", {
    async ensureInitialConsoleMember(userId) {
      ownerSeeds.push(String(userId || ""));
      return String(userId || "");
    }
  });

  registerConsoleBootstrap(app);
  registerUsersBootstrap(app);

  const payload = await resolveBootstrapPayload(app, {
    request: {
      async executeAction({ actionId }) {
        assert.equal(actionId, "auth.session.read");
        return {
          authenticated: true,
          profile,
          session: {
            csrfToken: "csrf-1"
          }
        };
      }
    },
    reply: {}
  });

  assert.deepEqual(ownerSeeds, ["12"]);
  assert.equal(payload.session.authenticated, true);
  assert.equal(payload.session.userId, "12");
  assert.deepEqual(payload.surfaceAccess, {
    consoleowner: true
  });
});
