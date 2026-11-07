import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createBootstrapRuntime, EventProvider } from "@jskit-ai/kernel/server/runtime";
import { UsersExtensionsProvider } from "../src/server/UsersExtensionsProvider.js";
import { UsersFeature } from "../src/server/UsersFeature.js";
import { UsersIdentityProvider } from "../src/server/UsersIdentityProvider.js";

test("UsersFeature assembles account behavior through explicit capabilities", async (t) => {
  const routes = [];
  const bootstrap = createBootstrapRuntime();
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  const resourceRuntime = await createTestResourceRuntime({ knex });
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
      "runtime.resources": resourceRuntime,
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

  assert.deepEqual(resourceRuntime.ownedTables(), [
    { name: "userProfiles", tableName: "users", featureId: "users.identity" },
    { name: "userSettings", tableName: "user_settings", featureId: "users.identity" }
  ]);
  assert.equal(typeof profiles.findByIdentity, "function");
  assert.equal(typeof profiles.createWithSettings, "function");
  assert.equal(typeof profiles.countUsers, "function");
  assert.deepEqual(
    ["query", "get", "pageLimits"].map((method) => typeof profiles[method]),
    ["function", "function", "function"],
    "users.profiles serves a CRUD feature's reads"
  );
  assert.equal(Object.hasOwn(profiles, "create"), false, "and no handle writes");
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
