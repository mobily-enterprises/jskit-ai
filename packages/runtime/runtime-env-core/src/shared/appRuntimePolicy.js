import path from "node:path";
import { toPositiveInteger } from "./integers.js";

const TENANCY_MODES = new Set(["personal", "team-single", "multi-workspace"]);
const WORKSPACE_PROVISIONING_MODES = new Set(["self-serve", "governed"]);

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

function normalizeWorkspaceProvisioningMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (WORKSPACE_PROVISIONING_MODES.has(normalized)) {
    return normalized;
  }
  return "self-serve";
}

function resolveAppConfig({ repositoryConfig, runtimeEnv, rootDir = process.cwd() } = {}) {
  if (!repositoryConfig || typeof repositoryConfig !== "object") {
    throw new Error("repositoryConfig is required.");
  }

  const appRepositoryConfig =
    repositoryConfig.app && typeof repositoryConfig.app === "object" ? repositoryConfig.app : {};
  const aiRepositoryConfig = repositoryConfig.ai && typeof repositoryConfig.ai === "object" ? repositoryConfig.ai : {};
  const socialRepositoryConfig =
    repositoryConfig.social && typeof repositoryConfig.social === "object" ? repositoryConfig.social : {};

  const tenancyMode = String(appRepositoryConfig.tenancyMode || "personal").trim();
  const normalizedTenancyMode = TENANCY_MODES.has(tenancyMode) ? tenancyMode : "personal";
  const workspaceProvisioningMode = normalizeWorkspaceProvisioningMode(
    appRepositoryConfig.workspaceProvisioningMode
  );

  const maxWorkspacesPerUserFallback = normalizedTenancyMode === "multi-workspace" ? 20 : 1;
  const maxWorkspacesPerUser = toPositiveInteger(
    appRepositoryConfig?.limits?.maxWorkspacesPerUser,
    maxWorkspacesPerUserFallback
  );
  const workspaceSwitchingDefault =
    normalizedTenancyMode === "multi-workspace" ? true : Boolean(appRepositoryConfig?.features?.workspaceSwitching);
  const workspaceInvitesDefault =
    normalizedTenancyMode === "personal" ? false : Boolean(appRepositoryConfig?.features?.workspaceInvites);
  const workspaceCreateEnabled =
    normalizedTenancyMode === "personal" ? false : Boolean(appRepositoryConfig?.features?.workspaceCreateEnabled);
  const assistantEnabled = Boolean(aiRepositoryConfig.enabled);
  const assistantRequiredPermission = String(aiRepositoryConfig.requiredPermission || "").trim();
  const socialEnabled = Boolean(socialRepositoryConfig.enabled);
  const socialFederationEnabled = socialEnabled && Boolean(socialRepositoryConfig.federationEnabled);

  const rbacManifestPath = resolveManifestPath(runtimeEnv?.RBAC_MANIFEST_PATH, rootDir);

  return {
    tenancyMode: normalizedTenancyMode,
    workspaceProvisioningMode,
    features: {
      workspaceSwitching: workspaceSwitchingDefault,
      workspaceInvites: workspaceInvitesDefault,
      workspaceCreateEnabled,
      assistantEnabled,
      assistantRequiredPermission,
      socialEnabled,
      socialFederationEnabled
    },
    limits: {
      maxWorkspacesPerUser
    },
    rbacManifestPath
  };
}

function toBrowserConfig(appConfig) {
  return {
    tenancyMode: appConfig.tenancyMode,
    features: {
      workspaceSwitching: Boolean(appConfig.features?.workspaceSwitching),
      workspaceInvites: Boolean(appConfig.features?.workspaceInvites),
      workspaceCreateEnabled: Boolean(appConfig.features?.workspaceCreateEnabled),
      assistantEnabled: Boolean(appConfig.features?.assistantEnabled),
      assistantRequiredPermission: String(appConfig.features?.assistantRequiredPermission || "").trim(),
      socialEnabled: Boolean(appConfig.features?.socialEnabled),
      socialFederationEnabled: Boolean(appConfig.features?.socialFederationEnabled)
    }
  };
}

const __testables = {
  toPositiveInteger,
  resolveManifestPath,
  normalizeWorkspaceProvisioningMode
};

export { resolveAppConfig, toBrowserConfig, normalizeWorkspaceProvisioningMode, __testables };
