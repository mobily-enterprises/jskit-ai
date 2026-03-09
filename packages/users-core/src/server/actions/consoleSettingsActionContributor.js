import {
  normalizeObject,
  requireAuthenticated,
  requireServiceMethod,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

function resolveConsoleSurfaceIds(surfaceRuntime) {
  if (!surfaceRuntime || typeof surfaceRuntime.listEnabledSurfaceIds !== "function") {
    throw new Error("users.console-settings action contributor requires surfaceRuntime.listEnabledSurfaceIds().");
  }

  const enabledSurfaceIds = surfaceRuntime.listEnabledSurfaceIds();
  return enabledSurfaceIds.filter((surfaceId) => String(surfaceId || "").trim().toLowerCase() === "console");
}

function createConsoleSettingsActionContributor({ consoleSettingsService, surfaceRuntime } = {}) {
  const contributorId = "users.console-settings";
  const consoleSurfaceIds = resolveConsoleSurfaceIds(surfaceRuntime);

  requireServiceMethod(consoleSettingsService, "getSettings", contributorId, {
    serviceLabel: "consoleSettingsService"
  });
  requireServiceMethod(consoleSettingsService, "updateSettings", contributorId, {
    serviceLabel: "consoleSettingsService"
  });

  if (consoleSurfaceIds.length < 1) {
    return {
      contributorId,
      domain: "console",
      actions: Object.freeze([])
    };
  }

  const actions = [
    {
      id: "console.settings.read",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: Object.freeze([...consoleSurfaceIds]),
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "none",
      audit: {
        actionName: "console.settings.read"
      },
      observability: {},
      async execute() {
        return consoleSettingsService.getSettings();
      }
    },
    {
      id: "console.settings.update",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: Object.freeze([...consoleSurfaceIds]),
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: requireAuthenticated,
      idempotency: "optional",
      audit: {
        actionName: "console.settings.update"
      },
      observability: {},
      async execute(input) {
        return consoleSettingsService.updateSettings(normalizeObject(input));
      }
    }
  ];

  return {
    contributorId,
    domain: "console",
    actions: Object.freeze(actions)
  };
}

export { createConsoleSettingsActionContributor };
