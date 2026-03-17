import assert from "node:assert/strict";
import test from "node:test";

import { createServerRuntimeWithPlatformBundle } from "@jskit-ai/platform-server-runtime/server";
import { createComposedRuntimeBundles } from "../../server/framework/composeRuntime.js";
import { buildRoutesFromComposedModules } from "../../server/framework/composeRoutes.js";
import {
  startComposedBackgroundRuntimes,
  stopComposedBackgroundRuntimes
} from "../../server/framework/composeBackgroundRuntimes.js";
import {
  FRAMEWORK_PROFILE_IDS,
  resolveFrameworkProfile,
  resolveServerModuleIdsForProfile
} from "../../shared/framework/profile.js";

function createReplyRecorder() {
  return {
    statusCode: null,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
    }
  };
}

test("boot runtime wires filtered profile health handler", async () => {
  const profile = resolveFrameworkProfile(FRAMEWORK_PROFILE_IDS.webSaasDefault);
  const profileModuleIds = resolveServerModuleIdsForProfile(profile, { optionalModulePacks: "core" });
  const enabledModuleIds = profileModuleIds.filter((moduleId) => moduleId === "health");

  const { platformBundle, appFeatureBundle } = createComposedRuntimeBundles({
    enabledModuleIds,
    profileId: profile.id
  });

  const runtime = createServerRuntimeWithPlatformBundle({
    platformBundle,
    appFeatureBundle,
    dependencies: {}
  });

  assert.equal(typeof runtime.controllers.health?.getHealth, "function");

  const routes = buildRoutesFromComposedModules({
    controllers: runtime.controllers,
    enabledModuleIds,
    profileId: profile.id
  });

  const healthRoute = routes.find(
    (route) => route.method === "GET" && route.path === "/api/health"
  );
  assert.ok(healthRoute, "Expected /api/health to be wired.");

  const reply = createReplyRecorder();
  await healthRoute.handler({}, reply);

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload?.ok, true);
  assert.equal(reply.payload?.status, "ok");
});

test("background runtime lifecycle starts and stops configured services", () => {
  let started = 0;
  let stopped = 0;

  const runtimeServices = {
    socialOutboxWorkerRuntimeService: {
      start() {
        started += 1;
      },
      stop() {
        stopped += 1;
      }
    }
  };

  const extensionModules = [
    {
      id: "boot-runtime-test",
      tier: "extension",
      contributions: {
        backgroundRuntimeServices: ["socialOutboxWorkerRuntimeService"]
      }
    }
  ];

  const options = {
    enabledModuleIds: ["boot-runtime-test"],
    extensionModules,
    profileId: FRAMEWORK_PROFILE_IDS.webSaasDefault,
    mode: "strict"
  };

  startComposedBackgroundRuntimes(runtimeServices, options);
  stopComposedBackgroundRuntimes(runtimeServices, options);

  assert.equal(started, 1);
  assert.equal(stopped, 1);
});
