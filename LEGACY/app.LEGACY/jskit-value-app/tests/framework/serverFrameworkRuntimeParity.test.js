import assert from "node:assert/strict";
import test from "node:test";

import { resolveServerModuleRegistry } from "../../server/framework/moduleRegistry.js";
import { composeServerRuntimeArtifacts, createComposedRuntimeBundles } from "../../server/framework/composeRuntime.js";
import { resolveFrameworkDependencyCheck } from "../../server/framework/dependencyCheck.js";
import { FRAMEWORK_PROFILE_IDS } from "../../shared/framework/profile.js";
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

test("composeServerRuntimeArtifacts returns parity with static runtime manifests", () => {
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

test("createComposedRuntimeBundles emits platform and app-feature bundles", () => {
  const { platformBundle, appFeatureBundle } = createComposedRuntimeBundles();

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

test("composeServerRuntimeArtifacts supports module filtering while preserving definition order", () => {
  const enabledModuleIds = ["auth", "health", "workspace", "actionRuntime", "history", "deg2rad"];
  const artifacts = composeServerRuntimeArtifacts({
    enabledModuleIds
  });

  assert.deepEqual(artifacts.repositoryDefinitions.map((entry) => entry.id), [
    "userProfilesRepository",
    "calculationLogsRepository",
    "workspacesRepository",
    "workspaceMembershipsRepository",
    "workspaceSettingsRepository",
    "workspaceInvitesRepository",
    "healthRepository"
  ]);

  assert.deepEqual(artifacts.serviceDefinitions.map((entry) => entry.id), [
    "authService",
    "deg2radHistoryService",
    "workspaceInviteEmailService",
    "workspaceService",
    "workspaceAdminService",
    "auditService",
    "realtimeEventsService",
    "healthService",
    "actionRuntimeServices",
    "actionRegistry",
    "actionExecutor"
  ]);

  assert.deepEqual(artifacts.controllerDefinitions.map((entry) => entry.id), ["auth", "history", "health", "workspace"]);
  assert.deepEqual(artifacts.runtimeServiceIds, [
    "authService",
    "workspaceService",
    "realtimeEventsService",
    "actionRegistry",
    "actionExecutor"
  ]);
  assert.deepEqual(artifacts.routeModuleIds, ["health", "auth", "workspace", "history", "deg2rad"]);
  assert.deepEqual(artifacts.appFeatureServiceDefinitions.map((entry) => entry.id), ["deg2radService"]);
  assert.deepEqual(artifacts.appFeatureControllerDefinitions.map((entry) => entry.id), ["deg2rad"]);
});

test("composeServerRuntimeArtifacts throws in strict mode when required capability provider is missing", () => {
  assert.throws(
    () =>
      composeServerRuntimeArtifacts({
        mode: "strict",
        enabledModuleIds: ["auth", "workspace", "history"]
      }),
    (error) => {
      assert.equal(error?.code, "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR");
      assert.equal(Array.isArray(error?.diagnostics), true);
      assert.equal(
        error.diagnostics.some(
          (entry) => entry.code === "MODULE_CAPABILITY_MISSING" && entry.moduleId === "history"
        ),
        true
      );
      return true;
    }
  );
});

test("composeServerRuntimeArtifacts disables missing-capability modules in permissive mode", () => {
  const artifacts = composeServerRuntimeArtifacts({
    mode: "permissive",
    enabledModuleIds: ["auth", "workspace", "history"]
  });

  assert.deepEqual(artifacts.moduleOrder, ["auth", "workspace"]);
  assert.equal(artifacts.routeModuleIds.includes("history"), false);
  assert.equal(artifacts.disabledModules.some((entry) => entry.id === "history"), true);
  assert.equal(
    artifacts.diagnostics.some(
      (entry) => entry.level === "warn" && entry.code === "MODULE_CAPABILITY_MISSING" && entry.moduleId === "history"
    ),
    true
  );
});

test("composeServerRuntimeArtifacts enforces required server profile modules when configured", () => {
  assert.throws(
    () =>
      composeServerRuntimeArtifacts({
        mode: "strict",
        profileId: FRAMEWORK_PROFILE_IDS.webSaasDefault,
        enforceProfileRequired: true,
        enabledModuleIds: ["auth", "health"]
      }),
    (error) => {
      assert.equal(error?.code, "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR");
      assert.equal(
        error.diagnostics.some((entry) => entry.code === "MODULE_PROFILE_REQUIRED_MODULE_MISSING"),
        true
      );
      return true;
    }
  );
});

test("composeServerRuntimeArtifacts supports optional module pack filtering", () => {
  const artifacts = composeServerRuntimeArtifacts({
    mode: "strict",
    profileId: FRAMEWORK_PROFILE_IDS.webSaasDefault,
    optionalModulePacks: ["social"],
    enforceProfileRequired: true
  });

  for (const requiredModuleId of ["observability", "auth", "workspace", "console", "health", "actionRuntime"]) {
    assert.equal(artifacts.moduleOrder.includes(requiredModuleId), true, `Missing required module ${requiredModuleId}.`);
  }
  assert.equal(artifacts.moduleOrder.includes("social"), true);
  assert.equal(artifacts.routeModuleIds.includes("social"), true);
  assert.equal(artifacts.routeModuleIds.includes("billing"), false);
  assert.equal(artifacts.disabledModules.some((entry) => entry.id === "billing"), true);
});

test("framework dependency check reports strict module/capability composition status", () => {
  const result = resolveFrameworkDependencyCheck();

  assert.equal(result.ok, true);
  assert.equal(result.mode, "strict");
  assert.equal(result.profileId, FRAMEWORK_PROFILE_IDS.webSaasDefault);
  assert.equal(result.moduleOrder.includes("auth"), true);
  assert.equal(result.capabilityProviders.some((provider) => provider.capabilityId === "cap.auth.identity"), true);
});

test("framework dependency check supports optional module pack filtering", () => {
  const result = resolveFrameworkDependencyCheck({
    optionalModulePacks: "+social"
  });

  assert.equal(result.ok, true);
  assert.equal(result.moduleOrder.includes("social"), true);
  assert.equal(result.moduleOrder.includes("billing"), false);
});

test("framework dependency check throws on strict dependency violations", () => {
  assert.throws(
    () =>
      resolveFrameworkDependencyCheck({
        mode: "strict",
        enabledModuleIds: ["billing"],
        enforceProfileRequired: false
      }),
    (error) => {
      assert.equal(error?.code, "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR");
      assert.equal(
        error.diagnostics.some(
          (entry) => entry.code === "MODULE_DEPENDENCY_MISSING" && entry.moduleId === "billing"
        ),
        true
      );
      return true;
    }
  );
});
