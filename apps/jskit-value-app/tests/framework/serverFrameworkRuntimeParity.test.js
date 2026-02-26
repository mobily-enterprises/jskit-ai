import assert from "node:assert/strict";
import test from "node:test";

import { resolveServerModuleRegistry } from "../../server/framework/moduleRegistry.js";
import { composeServerRuntimeArtifacts, createComposedLegacyRuntimeBundles } from "../../server/framework/composeRuntime.js";
import { PLATFORM_REPOSITORY_DEFINITIONS } from "../../server/runtime/repositories.js";
import { PLATFORM_SERVICE_DEFINITIONS, RUNTIME_SERVICE_EXPORT_IDS } from "../../server/runtime/services.js";
import { PLATFORM_CONTROLLER_DEFINITIONS } from "../../server/runtime/controllers.js";
import { APP_FEATURE_SERVICE_DEFINITIONS, APP_FEATURE_CONTROLLER_DEFINITIONS } from "../../server/runtime/appFeatureManifest.js";
import { ROUTE_MODULE_DEFINITIONS } from "../../server/modules/api/routes.js";

test("server module registry includes all first-party route modules", () => {
  const registryIds = new Set(resolveServerModuleRegistry().map((entry) => entry.id));
  const expectedRouteOwnedModules = [
    "health",
    "observability",
    "auth",
    "workspace",
    "console",
    "consoleErrors",
    "communications",
    "projects",
    "chat",
    "social",
    "billing",
    "ai",
    "settings",
    "alerts",
    "history",
    "deg2rad"
  ];

  for (const moduleId of expectedRouteOwnedModules) {
    assert.equal(registryIds.has(moduleId), true, `Missing module ${moduleId} in server framework registry.`);
  }
});

test("composeServerRuntimeArtifacts returns parity with legacy static manifests", () => {
  const artifacts = composeServerRuntimeArtifacts();

  assert.deepEqual(
    artifacts.repositoryDefinitions.map((entry) => entry.id),
    PLATFORM_REPOSITORY_DEFINITIONS.map((entry) => entry.id)
  );
  assert.deepEqual(
    artifacts.serviceDefinitions.map((entry) => entry.id),
    PLATFORM_SERVICE_DEFINITIONS.map((entry) => entry.id)
  );
  assert.deepEqual(
    artifacts.controllerDefinitions.map((entry) => entry.id),
    PLATFORM_CONTROLLER_DEFINITIONS.map((entry) => entry.id)
  );
  assert.deepEqual(artifacts.runtimeServiceIds, RUNTIME_SERVICE_EXPORT_IDS);
  assert.deepEqual(artifacts.routeModuleIds, ROUTE_MODULE_DEFINITIONS.map((entry) => entry.id));
  assert.deepEqual(
    artifacts.appFeatureServiceDefinitions.map((entry) => entry.id),
    APP_FEATURE_SERVICE_DEFINITIONS.map((entry) => entry.id)
  );
  assert.deepEqual(
    artifacts.appFeatureControllerDefinitions.map((entry) => entry.id),
    APP_FEATURE_CONTROLLER_DEFINITIONS.map((entry) => entry.id)
  );
});

test("createComposedLegacyRuntimeBundles emits legacy-compatible platform and app-feature bundles", () => {
  const { platformBundle, appFeatureBundle } = createComposedLegacyRuntimeBundles();

  assert.deepEqual(
    platformBundle.repositoryDefinitions.map((entry) => entry.id),
    PLATFORM_REPOSITORY_DEFINITIONS.map((entry) => entry.id)
  );
  assert.deepEqual(
    platformBundle.serviceDefinitions.map((entry) => entry.id),
    PLATFORM_SERVICE_DEFINITIONS.map((entry) => entry.id)
  );
  assert.deepEqual(
    platformBundle.controllerDefinitions.map((entry) => entry.id),
    PLATFORM_CONTROLLER_DEFINITIONS.map((entry) => entry.id)
  );
  assert.deepEqual(platformBundle.runtimeServiceIds, RUNTIME_SERVICE_EXPORT_IDS);
  assert.deepEqual(
    appFeatureBundle.serviceDefinitions.map((entry) => entry.id),
    APP_FEATURE_SERVICE_DEFINITIONS.map((entry) => entry.id)
  );
  assert.deepEqual(
    appFeatureBundle.controllerDefinitions.map((entry) => entry.id),
    APP_FEATURE_CONTROLLER_DEFINITIONS.map((entry) => entry.id)
  );
});

test("composeServerRuntimeArtifacts supports module filtering while preserving legacy definition order", () => {
  const artifacts = composeServerRuntimeArtifacts({
    enabledModuleIds: ["auth", "health", "actionRuntime", "deg2rad"]
  });

  assert.deepEqual(artifacts.repositoryDefinitions.map((entry) => entry.id), [
    "userProfilesRepository",
    "healthRepository"
  ]);

  assert.deepEqual(artifacts.serviceDefinitions.map((entry) => entry.id), [
    "authService",
    "healthService",
    "actionRuntimeServices",
    "actionRegistry",
    "actionExecutor"
  ]);

  assert.deepEqual(artifacts.controllerDefinitions.map((entry) => entry.id), ["auth", "health"]);
  assert.deepEqual(artifacts.runtimeServiceIds, ["authService", "actionRegistry", "actionExecutor"]);
  assert.deepEqual(artifacts.routeModuleIds, ["health", "auth", "deg2rad"]);
  assert.deepEqual(artifacts.appFeatureServiceDefinitions.map((entry) => entry.id), ["deg2radService"]);
  assert.deepEqual(artifacts.appFeatureControllerDefinitions.map((entry) => entry.id), ["deg2rad"]);
});
