import assert from "node:assert/strict";
import test from "node:test";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createBootstrapRuntime } from "@jskit-ai/kernel/server/runtime";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
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
  const authExtensions = createAuthExtensions();
  const jsonRestApi = createJsonRestApiFixture();
  let users = null;
  let actionCatalogue = null;
  const probe = defineProvider({
    id: "test.users.probe",
    requires: {
      actions: "runtime.actions",
      usersCapability: "users.core"
    },
    setup({ actions, usersCapability }) {
      actionCatalogue = actions;
      users = usersCapability;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.extensions": authExtensions,
      "auth.service": {},
      "runtime.bootstrap": bootstrap,
      "runtime.database": { knex() {} },
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
    providers: [createActionProvider(), UsersExtensionsProvider, UsersIdentityProvider, UsersFeature, probe]
  });

  await runtime.start();

  assert.deepEqual(Object.keys(jsonRestApi.resources).sort(), ["userProfiles", "userSettings"]);
  assert.equal(typeof users.repositories.userProfiles.findByIdentity, "function");
  assert.equal(typeof users.services.accountProfile.updateProfile, "function");
  assert.equal(routes.includes("GET /api/settings"), true);
  assert.equal(routes.includes("POST /api/settings/security/change-password"), true);
  assert.equal(actionCatalogue.listDefinitions().length, 11);
  assert.deepEqual(bootstrap.diagnostics().contributorIds, ["users.bootstrap"]);
  assert.equal(authExtensions.resolveProfileProjector().projectorId, "users.profile");
});
