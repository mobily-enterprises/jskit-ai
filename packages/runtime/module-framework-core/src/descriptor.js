const MODULE_TIERS = Object.freeze({
  kernel: "kernel",
  foundation: "foundation",
  feature: "feature",
  extension: "extension"
});

const MODULE_ENABLEMENT_MODES = Object.freeze({
  strict: "strict",
  permissive: "permissive"
});

const MODULE_SURFACES = new Set(["app", "admin", "console", "global"]);
const SERVER_HOOK_KEYS = new Set([
  "repositories",
  "services",
  "controllers",
  "routes",
  "fastifyPlugins",
  "actions",
  "realtimeTopics",
  "workers",
  "migrations",
  "seeds",
  "docs"
]);
const CLIENT_HOOK_KEYS = new Set(["api", "routes", "guards", "nav", "realtime", "featureFlags"]);
const DIAGNOSTIC_HOOK_KEYS = new Set(["startupChecks", "healthChecks"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureNonEmptyString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

function ensureStringArray(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.map((entry, index) => ensureNonEmptyString(entry, `${label}[${index}]`));
}

function normalizeDependencyList(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TypeError(`${label}[${index}] must be an object.`);
    }

    const normalized = {
      id: ensureNonEmptyString(entry.id, `${label}[${index}].id`)
    };

    if (entry.range != null && String(entry.range || "").trim()) {
      normalized.range = String(entry.range).trim();
    }

    normalized.optional = Boolean(entry.optional);
    return normalized;
  });
}

function normalizeCapabilityRequirements(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TypeError(`${label}[${index}] must be an object.`);
    }

    const normalized = {
      id: ensureNonEmptyString(entry.id, `${label}[${index}].id`)
    };

    if (entry.range != null && String(entry.range || "").trim()) {
      normalized.range = String(entry.range).trim();
    }

    normalized.optional = Boolean(entry.optional);
    return normalized;
  });
}

function normalizeCapabilityProviders(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TypeError(`${label}[${index}] must be an object.`);
    }

    return {
      id: ensureNonEmptyString(entry.id, `${label}[${index}].id`),
      version: ensureNonEmptyString(entry.version, `${label}[${index}].version`)
    };
  });
}

function normalizeHookBlock(block, allowedKeys, label) {
  if (block == null) {
    return undefined;
  }
  if (!isPlainObject(block)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const normalized = {};

  for (const [key, value] of Object.entries(block)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
    if (typeof value !== "function") {
      throw new TypeError(`${label}.${key} must be a function.`);
    }
    normalized[key] = value;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeProfilePolicy(profilePolicy) {
  if (profilePolicy == null) {
    return undefined;
  }
  if (!isPlainObject(profilePolicy)) {
    throw new TypeError("descriptor.profilePolicy must be an object.");
  }

  const normalized = {
    requiredInProfiles: ensureStringArray(profilePolicy.requiredInProfiles, "descriptor.profilePolicy.requiredInProfiles"),
    forbiddenInProfiles: ensureStringArray(
      profilePolicy.forbiddenInProfiles,
      "descriptor.profilePolicy.forbiddenInProfiles"
    )
  };

  return normalized.requiredInProfiles.length || normalized.forbiddenInProfiles.length ? normalized : undefined;
}

function normalizeMounts(value) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError("descriptor.mounts must be an array.");
  }

  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TypeError(`descriptor.mounts[${index}] must be an object.`);
    }

    const normalized = {
      key: ensureNonEmptyString(entry.key, `descriptor.mounts[${index}].key`),
      defaultPath: ensureNonEmptyString(entry.defaultPath, `descriptor.mounts[${index}].defaultPath`),
      allowOverride: entry.allowOverride === undefined ? true : Boolean(entry.allowOverride),
      aliases: ensureStringArray(entry.aliases, `descriptor.mounts[${index}].aliases`)
    };

    if (entry.surface != null) {
      const surface = ensureNonEmptyString(entry.surface, `descriptor.mounts[${index}].surface`);
      if (!MODULE_SURFACES.has(surface)) {
        throw new TypeError(`descriptor.mounts[${index}].surface must be one of app/admin/console/global.`);
      }
      normalized.surface = surface;
    }

    return normalized;
  });
}

function normalizeConfig(config) {
  if (config == null) {
    return undefined;
  }
  if (!isPlainObject(config)) {
    throw new TypeError("descriptor.config must be an object.");
  }

  const defaults = config.defaults == null ? {} : config.defaults;
  if (!isPlainObject(defaults)) {
    throw new TypeError("descriptor.config.defaults must be an object.");
  }

  const env = config.env == null ? [] : config.env;
  if (!Array.isArray(env)) {
    throw new TypeError("descriptor.config.env must be an array.");
  }

  const normalizedEnv = env.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TypeError(`descriptor.config.env[${index}] must be an object.`);
    }

    const normalized = {
      key: ensureNonEmptyString(entry.key, `descriptor.config.env[${index}].key`)
    };

    if (entry.requiredWhen != null) {
      if (typeof entry.requiredWhen !== "function") {
        throw new TypeError(`descriptor.config.env[${index}].requiredWhen must be a function.`);
      }
      normalized.requiredWhen = entry.requiredWhen;
    }

    return normalized;
  });

  if (config.migrate != null && typeof config.migrate !== "function") {
    throw new TypeError("descriptor.config.migrate must be a function.");
  }

  const normalized = {
    defaults,
    env: normalizedEnv
  };

  if (Object.hasOwn(config, "schema")) {
    normalized.schema = config.schema;
  }

  if (config.migrate) {
    normalized.migrate = config.migrate;
  }

  return normalized;
}

function deepFreeze(value, visited = new WeakSet()) {
  if (!value || typeof value !== "object" || visited.has(value)) {
    return value;
  }

  visited.add(value);

  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze(value[key], visited);
  }

  return Object.freeze(value);
}

function validateModuleDescriptor(descriptor) {
  if (!isPlainObject(descriptor)) {
    throw new TypeError("descriptor must be an object.");
  }

  const tier = ensureNonEmptyString(descriptor.tier, "descriptor.tier");
  if (!Object.hasOwn(MODULE_TIERS, tier)) {
    throw new TypeError("descriptor.tier must be one of kernel/foundation/feature/extension.");
  }

  if (descriptor.enabled != null && typeof descriptor.enabled !== "function") {
    throw new TypeError("descriptor.enabled must be a function.");
  }

  if (descriptor.appFeatures != null && typeof descriptor.appFeatures !== "function") {
    throw new TypeError("descriptor.appFeatures must be a function.");
  }

  const normalized = {
    id: ensureNonEmptyString(descriptor.id, "descriptor.id"),
    version: ensureNonEmptyString(descriptor.version, "descriptor.version"),
    tier,
    dependsOnModules: normalizeDependencyList(descriptor.dependsOnModules, "descriptor.dependsOnModules"),
    requiresCapabilities: normalizeCapabilityRequirements(
      descriptor.requiresCapabilities,
      "descriptor.requiresCapabilities"
    ),
    providesCapabilities: normalizeCapabilityProviders(
      descriptor.providesCapabilities,
      "descriptor.providesCapabilities"
    ),
    mounts: normalizeMounts(descriptor.mounts)
  };

  if (descriptor.enabled) {
    normalized.enabled = descriptor.enabled;
  }

  const profilePolicy = normalizeProfilePolicy(descriptor.profilePolicy);
  if (profilePolicy) {
    normalized.profilePolicy = profilePolicy;
  }

  const config = normalizeConfig(descriptor.config);
  if (config) {
    normalized.config = config;
  }

  const server = normalizeHookBlock(descriptor.server, SERVER_HOOK_KEYS, "descriptor.server");
  if (server) {
    normalized.server = server;
  }

  const client = normalizeHookBlock(descriptor.client, CLIENT_HOOK_KEYS, "descriptor.client");
  if (client) {
    normalized.client = client;
  }

  const diagnostics = normalizeHookBlock(descriptor.diagnostics, DIAGNOSTIC_HOOK_KEYS, "descriptor.diagnostics");
  if (diagnostics) {
    normalized.diagnostics = diagnostics;
  }

  if (descriptor.appFeatures) {
    normalized.appFeatures = descriptor.appFeatures;
  }

  return normalized;
}

function validateModuleDescriptors(descriptors) {
  if (!Array.isArray(descriptors)) {
    throw new TypeError("descriptors must be an array.");
  }

  const normalized = descriptors.map((entry, index) => {
    try {
      return validateModuleDescriptor(entry);
    } catch (error) {
      error.message = `descriptor[${index}] invalid: ${error.message}`;
      throw error;
    }
  });

  const seen = new Set();
  for (const descriptor of normalized) {
    if (seen.has(descriptor.id)) {
      throw new TypeError(`Duplicate module id \"${descriptor.id}\".`);
    }
    seen.add(descriptor.id);
  }

  return normalized;
}

function defineModule(descriptor) {
  return deepFreeze(validateModuleDescriptor(descriptor));
}

export {
  MODULE_TIERS,
  MODULE_ENABLEMENT_MODES,
  defineModule,
  validateModuleDescriptor,
  validateModuleDescriptors
};
