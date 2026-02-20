import path from "node:path";

const TENANCY_MODES = new Set(["personal", "team-single", "multi-workspace"]);

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return fallback;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function resolveManifestPath(manifestPath, rootDir) {
  const raw = String(manifestPath || "").trim();
  if (!raw) {
    return path.resolve(rootDir, "shared", "auth", "rbac.manifest.json");
  }

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.resolve(rootDir, raw);
}

function resolveAppConfig(runtimeEnv, options = {}) {
  const rootDir = String(options.rootDir || process.cwd());
  const tenancyMode = String(runtimeEnv?.TENANCY_MODE || "personal").trim();
  const normalizedTenancyMode = TENANCY_MODES.has(tenancyMode) ? tenancyMode : "personal";

  const maxWorkspacesPerUserFallback = normalizedTenancyMode === "multi-workspace" ? 20 : 1;
  const maxWorkspacesPerUser = toPositiveInteger(runtimeEnv?.MAX_WORKSPACES_PER_USER, maxWorkspacesPerUserFallback);
  const workspaceSwitchingDefault =
    normalizedTenancyMode === "multi-workspace" ? true : toBoolean(runtimeEnv?.WORKSPACE_SWITCHING_DEFAULT, false);
  const workspaceInvitesDefault =
    normalizedTenancyMode === "personal" ? false : toBoolean(runtimeEnv?.WORKSPACE_INVITES_DEFAULT, true);
  const workspaceCreateEnabled =
    normalizedTenancyMode === "personal" ? false : toBoolean(runtimeEnv?.WORKSPACE_CREATE_ENABLED, true);
  const assistantEnabled = toBoolean(runtimeEnv?.AI_ENABLED, false);
  const assistantRequiredPermission = String(runtimeEnv?.AI_REQUIRED_PERMISSION || "").trim();

  const rbacManifestPath = resolveManifestPath(runtimeEnv?.RBAC_MANIFEST_PATH, rootDir);

  return {
    tenancyMode: normalizedTenancyMode,
    features: {
      workspaceSwitching: workspaceSwitchingDefault,
      workspaceInvites: workspaceInvitesDefault,
      workspaceCreateEnabled,
      assistantEnabled,
      assistantRequiredPermission
    },
    limits: {
      maxWorkspacesPerUser
    },
    rbacManifestPath
  };
}

function toPublicAppConfig(appConfig) {
  return {
    tenancyMode: appConfig.tenancyMode,
    features: {
      workspaceSwitching: Boolean(appConfig.features?.workspaceSwitching),
      workspaceInvites: Boolean(appConfig.features?.workspaceInvites),
      workspaceCreateEnabled: Boolean(appConfig.features?.workspaceCreateEnabled),
      assistantEnabled: Boolean(appConfig.features?.assistantEnabled),
      assistantRequiredPermission: String(appConfig.features?.assistantRequiredPermission || "").trim()
    }
  };
}

export { resolveAppConfig, toPublicAppConfig };
