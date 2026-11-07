import assert from "node:assert/strict";
import test from "node:test";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createBootstrapRuntime, EventProvider } from "@jskit-ai/kernel/server/runtime";
import { UsersExtensionsProvider } from "../src/server/UsersExtensionsProvider.js";
import { UsersFeature } from "../src/server/UsersFeature.js";
import { UsersIdentityProvider } from "../src/server/UsersIdentityProvider.js";

function createJsonRestApiFixture() {
  const resources = {};
  return {
    resources,
    async addResource(scopeName) {
      resources[scopeName] = Object.freeze({
        query: async () => ({ data: [] }),
        post: async () => null,
        patch: async () => null
      });
    }
  };
}

test("UsersFeature assembles account behavior through explicit capabilities", async () => {
  const routes = [];
  const bootstrap = createBootstrapRuntime();
  const jsonRestApi = createJsonRestApiFixture();
  let users = null;
  let profiles = null;
  let settings = null;
  let actionCatalogue = null;
  let profileProjector = null;
  const probe = defineProvider({
    id: "test.users.probe",
    requires: {
      actions: "runtime.actions",
      projector: "auth.profile.projector",
      profilesCapability: "users.profiles",
      settingsCapability: "users.settings",
      usersCapability: "users.core"
    },
    setup({ actions, projector, profilesCapability, settingsCapability, usersCapability }) {
      actionCatalogue = actions;
      profileProjector = projector;
      profiles = profilesCapability;
      settings = settingsCapability;
      users = usersCapability;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.logger": silentLogger,
      "auth.service": {},
      "runtime.bootstrap": bootstrap,
      "runtime.http": {
        router: {
          register(method, path) {
            routes.push(`${method} ${path}`);
          }
        }
      },
      "runtime.json-rest-api": jsonRestApi,
      "runtime.storage": {
        async getItemRaw() { return null; },
        async setItemRaw() {},
        async removeItem() {}
      },
      "runtime.uploads": { readSingleMultipartFile() {} }
    },
    providers: [EventProvider, ActionProvider, UsersExtensionsProvider, UsersIdentityProvider, UsersFeature, probe]
  });

  await runtime.start();

  assert.deepEqual(Object.keys(jsonRestApi.resources).sort(), ["userProfiles", "userSettings"]);
  assert.equal(typeof profiles.findByIdentity, "function");
  assert.equal(typeof profiles.createWithSettings, "function");
  assert.equal(typeof profiles.countUsers, "function");
  assert.equal(typeof settings.ensureForUserId, "function");
  assert.equal(Object.hasOwn(users, "repositories"), false);
  assert.equal(typeof users.services.accountProfile.updateProfile, "function");
  assert.equal(routes.includes("GET /api/settings"), true);
  assert.equal(routes.includes("POST /api/settings/security/change-password"), true);
  assert.equal(actionCatalogue.listDefinitions().length, 11);
  assert.deepEqual(bootstrap.diagnostics().contributorIds, ["users.bootstrap"]);
  assert.equal(typeof profileProjector.syncIdentityProfile, "function");
  assert.equal(typeof profileProjector.findByIdentity, "function");
});
