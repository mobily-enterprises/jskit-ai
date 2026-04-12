import { normalizePagesRelativeTargetRoot } from "@jskit-ai/kernel/server/support";
import { createCliError } from "../shared/cliError.js";
import {
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";
import {
  interpolateOptionValue,
  promptForRequiredOption
} from "../shared/optionInterpolation.js";
import {
  normalizeWhenSourceValue,
  resolveWhenConfigValue
} from "./mutationWhen.js";
import { loadMutationWhenConfigContext } from "./ioAndMigrations.js";

const WORKSPACE_VISIBILITY_LEVELS = Object.freeze(["workspace", "workspace_user"]);
const WORKSPACE_VISIBILITY_SET = new Set(WORKSPACE_VISIBILITY_LEVELS);
const OPTION_VALIDATION_ENABLED_SURFACE_ID = "enabled-surface-id";
const OPTION_NORMALIZATION_PAGES_RELATIVE_TARGET_ROOT = "pages-relative-target-root";

function normalizeSurfaceIdForMutation(value = "") {
  return String(value || "").trim().toLowerCase();
}

function parseSurfaceIdListForMutation(value = "") {
  const normalized = String(value || "");
  if (!normalized.trim()) {
    return [];
  }

  return [
    ...new Set(
      normalized
        .split(",")
        .map((entry) => normalizeSurfaceIdForMutation(entry))
        .filter(Boolean)
    )
  ];
}

function resolveSurfaceVisibilityOptionPolicy(packageEntry = {}) {
  const descriptor = ensureObject(packageEntry?.descriptor);
  const optionPolicies = ensureObject(descriptor.optionPolicies);
  const surfaceVisibilityPolicy = optionPolicies.surfaceVisibility;
  if (!surfaceVisibilityPolicy || surfaceVisibilityPolicy === false) {
    return null;
  }

  let policy = {};
  if (surfaceVisibilityPolicy === true) {
    policy = {};
  } else if (typeof surfaceVisibilityPolicy === "object" && !Array.isArray(surfaceVisibilityPolicy)) {
    policy = ensureObject(surfaceVisibilityPolicy);
  } else {
    throw createCliError(
      `Invalid option policy in package ${packageEntry.packageId}: surfaceVisibility must be true or an object.`
    );
  }

  const surfaceOption = String(policy.surfaceOption || "surface").trim();
  const visibilityOption = String(policy.visibilityOption || "visibility").trim();
  if (!surfaceOption || !visibilityOption) {
    throw createCliError(
      `Invalid option policy in package ${packageEntry.packageId}: surfaceVisibility requires non-empty surfaceOption and visibilityOption.`
    );
  }

  return Object.freeze({
    surfaceOption,
    visibilityOption,
    allowAuto: policy.allowAuto !== false
  });
}

function resolveSurfaceDefinitionsForOptionPolicy(configContext = {}) {
  const publicConfig = ensureObject(configContext.public);
  const mergedConfig = ensureObject(configContext.merged);
  const sourceDefinitions = ensureObject(publicConfig.surfaceDefinitions);
  const fallbackDefinitions = ensureObject(mergedConfig.surfaceDefinitions);
  const surfaceDefinitions =
    Object.keys(sourceDefinitions).length > 0 ? sourceDefinitions : fallbackDefinitions;

  const normalizedDefinitions = {};
  for (const [key, value] of Object.entries(surfaceDefinitions)) {
    const definition = ensureObject(value);
    const definitionId = normalizeSurfaceIdForMutation(definition.id || key);
    if (!definitionId) {
      continue;
    }

    normalizedDefinitions[definitionId] = Object.freeze({
      id: definitionId,
      label: String(definition.label || "").trim(),
      enabled: definition.enabled !== false,
      requiresWorkspace: definition.requiresWorkspace === true
    });
  }

  return Object.freeze(normalizedDefinitions);
}

function normalizeResolvedOptionValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeResolvedOptionSchemaValue({
  packageEntry,
  optionName = "",
  schema = {},
  value = ""
} = {}) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  const normalizationType = normalizeResolvedOptionValue(schema?.normalizationType);
  if (!normalizationType) {
    return normalizedValue;
  }

  if (normalizationType === OPTION_NORMALIZATION_PAGES_RELATIVE_TARGET_ROOT) {
    return normalizePagesRelativeTargetRoot(normalizedValue, {
      context: `package ${String(packageEntry?.packageId || "unknown-package")}`,
      label: `option "${String(optionName || "").trim() || "unknown"}"`
    }).slice("src/pages/".length);
  }

  throw createCliError(
    `Invalid option normalization type in package ${String(packageEntry?.packageId || "unknown-package")}: ${String(schema?.normalizationType || "").trim()}.`
  );
}

function resolveSchemaValidatedOptionNames(packageEntry = {}, validationType = "", { optionNames = null } = {}) {
  const normalizedValidationType = String(validationType || "").trim().toLowerCase();
  if (!normalizedValidationType) {
    return [];
  }

  const optionSchemas = ensureObject(packageEntry?.descriptor?.options);
  const candidateOptionNames = Array.isArray(optionNames) && optionNames.length > 0
    ? optionNames
    : Object.keys(optionSchemas);

  return [
    ...new Set(
      candidateOptionNames.filter((optionName) => {
        const schema = ensureObject(optionSchemas[optionName]);
        return normalizeResolvedOptionValue(schema.validationType) === normalizedValidationType;
      })
    )
  ];
}

function validateEnabledSurfaceOptionValues({
  packageEntry,
  resolvedOptions = {},
  optionNames = null,
  configContext = {}
} = {}) {
  const validatedOptionNames = resolveSchemaValidatedOptionNames(
    packageEntry,
    OPTION_VALIDATION_ENABLED_SURFACE_ID,
    { optionNames }
  );
  if (validatedOptionNames.length < 1) {
    return;
  }

  const providedSurfaceOptionNames = validatedOptionNames.filter((optionName) => {
    return normalizeSurfaceIdForMutation(resolvedOptions?.[optionName]).length > 0;
  });
  if (providedSurfaceOptionNames.length < 1) {
    return;
  }

  const packageId = String(packageEntry?.packageId || "").trim() || "unknown-package";
  const surfaceDefinitions = resolveSurfaceDefinitionsForOptionPolicy(configContext);
  for (const optionName of providedSurfaceOptionNames) {
    const surfaceId = normalizeSurfaceIdForMutation(resolvedOptions?.[optionName]);
    const surfaceDefinition = surfaceDefinitions[surfaceId];
    if (!surfaceDefinition) {
      throw createCliError(
        `Invalid option for package ${packageId}: --${optionName} references unknown surface "${surfaceId}" in config/public.js.`
      );
    }
    if (surfaceDefinition.enabled !== true) {
      throw createCliError(
        `Invalid option for package ${packageId}: --${optionName} references disabled surface "${surfaceId}" in config/public.js.`
      );
    }
  }
}

function validateSurfaceVisibilityOptionPolicy({
  packageEntry,
  resolvedOptions = {},
  policy,
  configContext = {}
} = {}) {
  const packageId = String(packageEntry?.packageId || "").trim() || "unknown-package";
  const surfaceIds = parseSurfaceIdListForMutation(resolvedOptions?.[policy.surfaceOption]);
  const visibility = normalizeResolvedOptionValue(resolvedOptions?.[policy.visibilityOption]);
  if (surfaceIds.length < 1 || !visibility) {
    return;
  }
  const skipWorkspaceRequirement = policy.allowAuto && visibility === "auto";

  const surfaceDefinitions = resolveSurfaceDefinitionsForOptionPolicy(configContext);
  for (const surfaceId of surfaceIds) {
    const surfaceDefinition = surfaceDefinitions[surfaceId];
    if (!surfaceDefinition) {
      throw createCliError(
        `Invalid option combination for package ${packageId}: --${policy.surfaceOption} includes unknown surface "${surfaceId}" in config/public.js.`
      );
    }
    if (surfaceDefinition.enabled !== true) {
      throw createCliError(
        `Invalid option combination for package ${packageId}: surface "${surfaceId}" is disabled in config/public.js.`
      );
    }

    if (!skipWorkspaceRequirement && WORKSPACE_VISIBILITY_SET.has(visibility) && surfaceDefinition.requiresWorkspace !== true) {
      throw createCliError(
        `Invalid option combination for package ${packageId}: --${policy.visibilityOption} "${visibility}" requires surfaces with requiresWorkspace=true, but "${surfaceId}" has requiresWorkspace=false.`
      );
    }
  }
}

async function validateResolvedOptionPolicies({
  packageEntry,
  resolvedOptions = {},
  appRoot = "",
  resolveConfigContext
} = {}) {
  const policy = resolveSurfaceVisibilityOptionPolicy(packageEntry);
  if (!policy) {
    return;
  }
  if (!appRoot) {
    return;
  }

  const configContext = await resolveConfigContext();
  validateSurfaceVisibilityOptionPolicy({
    packageEntry,
    resolvedOptions,
    policy,
    configContext
  });
}

function resolvePromptChoicesForOption({ schema = {}, configContext = {} } = {}) {
  const validationType = normalizeResolvedOptionValue(schema.validationType);
  if (validationType !== OPTION_VALIDATION_ENABLED_SURFACE_ID) {
    return [];
  }

  const surfaceDefinitions = resolveSurfaceDefinitionsForOptionPolicy(configContext);
  return Object.values(surfaceDefinitions)
    .filter((entry) => entry.enabled === true)
    .map((entry) => Object.freeze({
      value: entry.id,
      label: entry.label && entry.label.toLowerCase() !== entry.id.toLowerCase()
        ? `${entry.id} (${entry.label})`
        : entry.id
    }));
}

async function validateOptionValuesForPackage({
  packageEntry,
  resolvedOptions = {},
  appRoot = "",
  optionNames = null
} = {}) {
  if (!appRoot) {
    return;
  }

  const validatedOptionNames = resolveSchemaValidatedOptionNames(
    packageEntry,
    OPTION_VALIDATION_ENABLED_SURFACE_ID,
    { optionNames }
  );
  if (validatedOptionNames.length < 1) {
    return;
  }

  const configContext = await loadMutationWhenConfigContext(appRoot);
  validateEnabledSurfaceOptionValues({
    packageEntry,
    resolvedOptions,
    optionNames: validatedOptionNames,
    configContext
  });
}

async function resolvePackageOptions(packageEntry, inlineOptions, io, { appRoot = "" } = {}) {
  const optionSchemas = ensureObject(packageEntry.descriptor.options);
  const optionNames = Object.keys(optionSchemas);
  const resolved = {};
  const inlineOptionValues = ensureObject(inlineOptions);
  const hasInlineOption = (name) => Object.prototype.hasOwnProperty.call(inlineOptionValues, name);
  let configContext = null;

  async function loadConfigContext() {
    if (!configContext) {
      configContext = await loadMutationWhenConfigContext(appRoot);
    }
    return configContext;
  }

  async function resolveOptionDefaultFromConfig(configPath = "") {
    const normalizedConfigPath = String(configPath || "").trim();
    if (!normalizedConfigPath || !appRoot) {
      return "";
    }

    await loadConfigContext();
    return normalizeWhenSourceValue(resolveWhenConfigValue(configContext, normalizedConfigPath));
  }

  function resolveOptionDefaultFromTemplate(template = "", optionName = "") {
    const normalizedTemplate = String(template || "").trim();
    if (!normalizedTemplate) {
      return "";
    }

    try {
      return String(
        interpolateOptionValue(
          normalizedTemplate,
          resolved,
          packageEntry.packageId,
          `option-default:${String(optionName || "").trim()}`
        )
      );
    } catch (error) {
      const message = String(error?.message || error || "");
      if (message.includes("Missing required option")) {
        return "";
      }
      throw error;
    }
  }

  for (const optionName of optionNames) {
    const schema = ensureObject(optionSchemas[optionName]);
    const allowEmpty = schema.allowEmpty === true;
    const assignResolvedOption = (rawValue = "") => {
      const normalizedOptionValue = normalizeResolvedOptionSchemaValue({
        packageEntry,
        optionName,
        schema,
        value: rawValue
      });
      if (normalizedOptionValue || allowEmpty) {
        resolved[optionName] = normalizedOptionValue;
        return true;
      }
      return false;
    };
    if (hasInlineOption(optionName)) {
      const inlineValue = String(inlineOptionValues[optionName] || "").trim();
      if (inlineValue || allowEmpty) {
        assignResolvedOption(inlineValue);
        continue;
      }
      if (schema.required) {
        throw createCliError(`Package ${packageEntry.packageId} option ${optionName} requires a non-empty value.`);
      }
    }

    const defaultFromConfigPath = String(schema.defaultFromConfig || "").trim();
    if (defaultFromConfigPath) {
      const defaultFromConfigValue = await resolveOptionDefaultFromConfig(defaultFromConfigPath);
      if (defaultFromConfigValue || allowEmpty) {
        assignResolvedOption(defaultFromConfigValue);
        continue;
      }
    }

    const defaultFromOptionTemplate = String(schema.defaultFromOptionTemplate || "").trim();
    if (defaultFromOptionTemplate) {
      const derivedOptionValue = resolveOptionDefaultFromTemplate(defaultFromOptionTemplate, optionName);
      if (derivedOptionValue || allowEmpty) {
        assignResolvedOption(derivedOptionValue);
        continue;
      }
    }

    if (typeof schema.defaultValue === "string" && schema.defaultValue.trim()) {
      assignResolvedOption(schema.defaultValue.trim());
      continue;
    }

    if (schema.required) {
      const promptConfigContext = appRoot ? await loadConfigContext() : {};
      assignResolvedOption(await promptForRequiredOption({
        ownerType: "package",
        ownerId: packageEntry.packageId,
        optionName,
        optionSchema: schema,
        promptChoices: resolvePromptChoicesForOption({ schema, configContext: promptConfigContext }),
        stdin: io.stdin,
        stdout: io.stdout
      }));
      continue;
    }

    resolved[optionName] = "";
  }

  await validateOptionValuesForPackage({
    packageEntry,
    resolvedOptions: resolved,
    appRoot
  });

  await validateResolvedOptionPolicies({
    packageEntry,
    resolvedOptions: resolved,
    appRoot,
    resolveConfigContext: loadConfigContext
  });

  return resolved;
}

function validateInlineOptionsForPackage(packageEntry, inlineOptions) {
  const optionSchemas = ensureObject(packageEntry?.descriptor?.options);
  const allowedOptionNames = Object.keys(optionSchemas);
  const allowed = new Set(allowedOptionNames);
  const providedOptionNames = Object.keys(ensureObject(inlineOptions));
  const unknownOptionNames = providedOptionNames.filter((optionName) => !allowed.has(optionName));

  if (unknownOptionNames.length < 1) {
    return;
  }

  const sortedUnknown = sortStrings(unknownOptionNames);
  const suffix = allowedOptionNames.length > 0
    ? ` Allowed options: ${sortStrings(allowedOptionNames).join(", ")}.`
    : " This package does not accept inline options.";

  throw createCliError(
    `Unknown option(s) for package ${packageEntry.packageId}: ${sortedUnknown.join(", ")}.${suffix}`
  );
}

async function validateInlineOptionValuesForPackage(
  packageEntry,
  inlineOptions,
  { appRoot = "", optionNames = null } = {}
) {
  await validateOptionValuesForPackage({
    packageEntry,
    resolvedOptions: ensureObject(inlineOptions),
    appRoot,
    optionNames
  });
}

export {
  normalizeSurfaceIdForMutation,
  parseSurfaceIdListForMutation,
  resolvePackageOptions,
  validateInlineOptionsForPackage,
  validateInlineOptionValuesForPackage
};
