import { MODULE_ENABLEMENT_MODES } from "@jskit-ai/module-framework-core";
import { normalizeOptionalModulePacks } from "../../shared/framework/profile.js";
import { composeServerRuntimeArtifacts } from "./composeRuntime.js";
import { loadFrameworkExtensions } from "./extensionsLoader.js";
import { normalizeProfileId } from "./profileUtils.js";

function normalizeMode(mode) {
  const normalized = String(mode || MODULE_ENABLEMENT_MODES.strict).trim().toLowerCase();
  if (normalized !== MODULE_ENABLEMENT_MODES.strict && normalized !== MODULE_ENABLEMENT_MODES.permissive) {
    throw new TypeError(`Unsupported framework extension validation mode "${normalized}".`);
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

function normalizeExtensionModulePaths(extensionModulePaths) {
  if (extensionModulePaths == null) {
    return undefined;
  }

  const rawEntries = Array.isArray(extensionModulePaths)
    ? extensionModulePaths
    : String(extensionModulePaths || "")
        .split(",")
        .map((entry) => String(entry || "").trim());

  const normalized = [];
  const seen = new Set();
  for (const rawEntry of rawEntries) {
    const normalizedEntry = String(rawEntry || "").trim();
    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue;
    }

    seen.add(normalizedEntry);
    normalized.push(normalizedEntry);
  }

  return normalized.length > 0 ? normalized : undefined;
}

async function resolveFrameworkExtensionsValidation({
  mode,
  enabledModuleIds,
  profileId,
  optionalModulePacks,
  enforceProfileRequired = true,
  extensionModulePaths,
  cwd = process.cwd()
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedProfileId = normalizeProfileId(profileId);
  const normalizedEnabledModuleIds = normalizeEnabledModuleIds(enabledModuleIds);
  const normalizedOptionalModulePacks = normalizeOptionalModulePacks(optionalModulePacks);
  const normalizedExtensionModulePaths = normalizeExtensionModulePaths(extensionModulePaths);

  if (!Array.isArray(normalizedExtensionModulePaths) || normalizedExtensionModulePaths.length < 1) {
    throw new TypeError("At least one extension module path must be provided.");
  }

  const extensionModules = await loadFrameworkExtensions({
    extensionModulePaths: normalizedExtensionModulePaths,
    cwd
  });

  const artifacts = composeServerRuntimeArtifacts({
    mode: normalizedMode,
    enabledModuleIds: normalizedEnabledModuleIds,
    profileId: normalizedProfileId,
    optionalModulePacks: normalizedOptionalModulePacks,
    enforceProfileRequired: Boolean(enforceProfileRequired),
    extensionModules
  });

  const extensionModuleIds = extensionModules.map((entry) => entry.id);
  const extensionModuleIdSet = new Set(extensionModuleIds);

  return Object.freeze({
    ok: true,
    mode: artifacts.mode,
    profileId: artifacts.profileId,
    extensionModulePaths: normalizedExtensionModulePaths,
    extensionModules: Object.freeze(
      extensionModules.map((entry) =>
        Object.freeze({
          id: entry.id,
          version: entry.version,
          tier: entry.tier
        })
      )
    ),
    moduleOrder: artifacts.moduleOrder,
    activeExtensionModuleIds: Object.freeze(artifacts.moduleOrder.filter((moduleId) => extensionModuleIdSet.has(moduleId))),
    disabledExtensionModules: Object.freeze(
      artifacts.disabledModules.filter((entry) => extensionModuleIdSet.has(entry.id))
    ),
    diagnostics: artifacts.diagnostics,
    enabledModuleIds: normalizedEnabledModuleIds || null,
    optionalModulePacks: normalizedOptionalModulePacks,
    extensionModuleIds: Object.freeze(extensionModuleIds)
  });
}

function formatFrameworkExtensionsValidationResult(result) {
  const output = [];
  output.push(`framework extensions validate: ok (${result.mode})`);
  output.push(`profile: ${result.profileId}`);
  output.push(`extensions (${result.extensionModules.length}): ${result.extensionModuleIds.join(", ")}`);
  output.push(`active extensions (${result.activeExtensionModuleIds.length}): ${result.activeExtensionModuleIds.join(", ") || "none"}`);

  if (result.disabledExtensionModules.length > 0) {
    output.push(`disabled extensions (${result.disabledExtensionModules.length}):`);
    for (const entry of result.disabledExtensionModules) {
      const reason = String(entry.reason || "unknown").trim() || "unknown";
      output.push(`- ${entry.id}: ${reason}`);
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

function formatFrameworkExtensionsValidationFailure(error) {
  const lines = [];
  lines.push(`framework extensions validate: failed (${String(error?.message || error)})`);

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

const __testables = {
  normalizeMode,
  normalizeProfileId,
  normalizeEnabledModuleIds,
  normalizeExtensionModulePaths
};

export {
  resolveFrameworkExtensionsValidation,
  formatFrameworkExtensionsValidationResult,
  formatFrameworkExtensionsValidationFailure,
  __testables
};
