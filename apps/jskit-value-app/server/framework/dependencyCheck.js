import { MODULE_ENABLEMENT_MODES } from "@jskit-ai/module-framework-core";
import { normalizeOptionalModulePacks } from "../../shared/framework/profile.js";
import { composeServerRuntimeArtifacts } from "./composeRuntime.js";
import { normalizeProfileId } from "./profileUtils.js";

function normalizeMode(mode) {
  const normalized = String(mode || MODULE_ENABLEMENT_MODES.strict).trim().toLowerCase();
  if (normalized !== MODULE_ENABLEMENT_MODES.strict && normalized !== MODULE_ENABLEMENT_MODES.permissive) {
    throw new TypeError(`Unsupported framework dependency check mode "${normalized}".`);
  }
  return normalized;
}

function normalizeEnabledModuleIds(enabledModuleIds) {
  if (enabledModuleIds == null) {
    return undefined;
  }

  if (Array.isArray(enabledModuleIds)) {
    const normalized = enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  }

  const normalized = String(enabledModuleIds || "")
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function resolveFrameworkDependencyCheck({
  mode,
  enabledModuleIds,
  profileId,
  optionalModulePacks,
  enforceProfileRequired = true
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedEnabledModuleIds = normalizeEnabledModuleIds(enabledModuleIds);
  const normalizedProfileId = normalizeProfileId(profileId);
  const normalizedOptionalModulePacks = normalizeOptionalModulePacks(optionalModulePacks);

  const artifacts = composeServerRuntimeArtifacts({
    mode: normalizedMode,
    enabledModuleIds: normalizedEnabledModuleIds,
    profileId: normalizedProfileId,
    optionalModulePacks: normalizedOptionalModulePacks,
    enforceProfileRequired: Boolean(enforceProfileRequired)
  });

  return Object.freeze({
    ok: true,
    mode: artifacts.mode,
    profileId: artifacts.profileId,
    optionalModulePacks: normalizedOptionalModulePacks,
    enabledModuleIds: normalizedEnabledModuleIds || null,
    moduleOrder: artifacts.moduleOrder,
    disabledModules: artifacts.disabledModules,
    capabilityProviders: Object.freeze(
      Object.values(artifacts.capabilityProviders)
        .map((provider) => ({
          capabilityId: provider.capabilityId,
          moduleId: provider.moduleId,
          version: provider.version
        }))
        .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId))
    ),
    diagnostics: artifacts.diagnostics
  });
}

function formatFrameworkDependencyCheckResult(result) {
  const output = [];
  output.push(`framework dependency check: ok (${result.mode})`);
  output.push(`profile: ${result.profileId}`);
  if (Array.isArray(result.optionalModulePacks) && result.optionalModulePacks.length > 0) {
    output.push(`optional packs: ${result.optionalModulePacks.join(", ")}`);
  }
  output.push(`active modules (${result.moduleOrder.length}): ${result.moduleOrder.join(", ")}`);

  if (result.disabledModules.length > 0) {
    output.push(`disabled modules (${result.disabledModules.length}):`);
    for (const entry of result.disabledModules) {
      const reason = String(entry.reason || "unknown").trim() || "unknown";
      output.push(`- ${entry.id}: ${reason}`);
    }
  }

  if (result.capabilityProviders.length > 0) {
    output.push(`capability providers (${result.capabilityProviders.length}):`);
    for (const provider of result.capabilityProviders) {
      output.push(`- ${provider.capabilityId}: ${provider.moduleId}@${provider.version}`);
    }
  }

  if (result.diagnostics.length > 0) {
    output.push(`diagnostics (${result.diagnostics.length}):`);
    for (const diagnostic of result.diagnostics) {
      output.push(
        `- [${diagnostic.level}] ${diagnostic.code}${diagnostic.moduleId ? ` (${diagnostic.moduleId})` : ""}: ${diagnostic.message}`
      );
    }
  }

  return `${output.join("\n")}\n`;
}

function formatFrameworkDependencyCheckFailure(error) {
  const lines = [];
  lines.push(`framework dependency check: failed (${String(error?.message || error)})`);

  const diagnostics = Array.isArray(error?.diagnostics) ? error.diagnostics : [];
  if (diagnostics.length > 0) {
    lines.push(`diagnostics (${diagnostics.length}):`);
    for (const diagnostic of diagnostics) {
      lines.push(
        `- [${diagnostic.level}] ${diagnostic.code}${diagnostic.moduleId ? ` (${diagnostic.moduleId})` : ""}: ${diagnostic.message}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

export {
  resolveFrameworkDependencyCheck,
  formatFrameworkDependencyCheckResult,
  formatFrameworkDependencyCheckFailure
};
