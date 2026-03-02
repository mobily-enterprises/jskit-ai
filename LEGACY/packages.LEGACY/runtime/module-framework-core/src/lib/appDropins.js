const DEFAULT_ORDER = 100;
const SERVER_EXTENSION_FILE_SUFFIX = ".server.js";
const CLIENT_EXTENSION_FILE_SUFFIX = ".client.js";
const DEFAULT_CLIENT_EXTENSION_SURFACE = "app";
const SERVER_DROPIN_CHANNEL_KINDS = Object.freeze(new Set(["server", "settings", "workers"]));

const SERVER_EXTENSION_KEYS = Object.freeze(
  new Set([
    "id",
    "order",
    "routes",
    "routePolicyOverrides",
    "realtimeTopics",
    "realtimePermissions",
    "fastifyPlugins",
    "backgroundRuntimes",
    "diagnostics"
  ])
);

const SETTINGS_EXTENSION_KEYS = Object.freeze(
  new Set(["id", "order", "fields", "validators", "persistence", "projection"])
);

const WORKER_EXTENSION_KEYS = Object.freeze(
  new Set(["id", "order", "workerRuntime", "queues", "processors"])
);

const CLIENT_EXTENSION_KEYS = Object.freeze(
  new Set([
    "id",
    "order",
    "routeFragments",
    "navigation",
    "guardPolicies",
    "realtimeInvalidation",
    "moduleContributions"
  ])
);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, contextLabel) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${contextLabel} must export an object.`);
  }
}

function assertKnownKeys(value, allowedKeys, contextLabel) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${contextLabel} uses unsupported key "${key}".`);
    }
  }
}

function normalizeId(value, contextLabel) {
  const id = String(value || "").trim();
  if (!id) {
    throw new TypeError(`${contextLabel} must define a non-empty id.`);
  }
  return id;
}

function normalizeOrder(value) {
  return Number.isFinite(value) ? Number(value) : DEFAULT_ORDER;
}

function normalizeList(value, contextLabel) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${contextLabel} must be an array.`);
  }
  return value.slice();
}

function normalizeServerDropinChannel(entry, contextLabel) {
  if (!isPlainObject(entry)) {
    throw new TypeError(`${contextLabel} must be an object.`);
  }
  const key = String(entry.key || "").trim();
  const directoryName = String(entry.directoryName || "").trim();
  const kind = String(entry.kind || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/.test(key)) {
    throw new TypeError(`${contextLabel}.key is invalid.`);
  }
  if (!directoryName) {
    throw new TypeError(`${contextLabel}.directoryName is required.`);
  }
  if (!SERVER_DROPIN_CHANNEL_KINDS.has(kind)) {
    throw new TypeError(
      `${contextLabel}.kind must be one of ${[...SERVER_DROPIN_CHANNEL_KINDS].join(", ")}.`
    );
  }
  return Object.freeze({
    key,
    directoryName,
    kind
  });
}

function resolveServerDropinChannels({
  extensionDirectory,
  settingsDirectory,
  workersDirectory,
  additionalChannels = []
} = {}) {
  const channels = [
    normalizeServerDropinChannel(
      {
        key: "server",
        directoryName: extensionDirectory,
        kind: "server"
      },
      "server dropin channel"
    ),
    normalizeServerDropinChannel(
      {
        key: "settings",
        directoryName: settingsDirectory,
        kind: "settings"
      },
      "settings dropin channel"
    ),
    normalizeServerDropinChannel(
      {
        key: "workers",
        directoryName: workersDirectory,
        kind: "workers"
      },
      "workers dropin channel"
    )
  ];

  for (const [index, channelEntry] of (Array.isArray(additionalChannels) ? additionalChannels : []).entries()) {
    channels.push(normalizeServerDropinChannel(channelEntry, `additionalChannels[${index}]`));
  }

  const seenKeys = new Set();
  for (const channel of channels) {
    if (seenKeys.has(channel.key)) {
      throw new Error(`Server dropin channel key "${channel.key}" is duplicated.`);
    }
    seenKeys.add(channel.key);
  }

  return Object.freeze(channels);
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function sortExtensions(entries, pathSelector) {
  return entries
    .slice()
    .sort(
      (left, right) =>
        left.order - right.order ||
        pathSelector(left).localeCompare(pathSelector(right)) ||
        left.id.localeCompare(right.id)
    );
}

function assertUniqueIds(entries, familyLabel, pathSelector) {
  const seen = new Map();
  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      seen.set(entry.id, pathSelector(entry));
      continue;
    }

    throw new Error(
      `${familyLabel} id "${entry.id}" is duplicated (${seen.get(entry.id)} and ${pathSelector(entry)}).`
    );
  }
}

function readEntityId(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (isPlainObject(value)) {
    return String(value.id || "").trim();
  }
  return "";
}

function assertUniqueEntityIds(entries, selector, label, pathSelector) {
  const seen = new Map();
  for (const entry of entries) {
    for (const item of selector(entry)) {
      const id = readEntityId(item);
      if (!id) {
        continue;
      }

      if (!seen.has(id)) {
        seen.set(id, pathSelector(entry));
        continue;
      }

      throw new Error(`${label} "${id}" is duplicated (${seen.get(id)} and ${pathSelector(entry)}).`);
    }
  }
}

function normalizeServerExtension(source, contextLabel) {
  assertPlainObject(source, contextLabel);
  assertKnownKeys(source, SERVER_EXTENSION_KEYS, contextLabel);
  return Object.freeze({
    id: normalizeId(source.id, contextLabel),
    order: normalizeOrder(source.order),
    routes: Object.freeze(normalizeList(source.routes, `${contextLabel}.routes`)),
    routePolicyOverrides: Object.freeze(
      normalizeList(source.routePolicyOverrides, `${contextLabel}.routePolicyOverrides`)
    ),
    realtimeTopics: Object.freeze(normalizeList(source.realtimeTopics, `${contextLabel}.realtimeTopics`)),
    realtimePermissions: Object.freeze(
      normalizeList(source.realtimePermissions, `${contextLabel}.realtimePermissions`)
    ),
    fastifyPlugins: Object.freeze(normalizeList(source.fastifyPlugins, `${contextLabel}.fastifyPlugins`)),
    backgroundRuntimes: Object.freeze(
      normalizeList(source.backgroundRuntimes, `${contextLabel}.backgroundRuntimes`)
    ),
    diagnostics: Object.freeze(normalizeList(source.diagnostics, `${contextLabel}.diagnostics`))
  });
}

function normalizeSettingsExtension(source, contextLabel) {
  assertPlainObject(source, contextLabel);
  assertKnownKeys(source, SETTINGS_EXTENSION_KEYS, contextLabel);

  const persistenceSource = isPlainObject(source.persistence) ? source.persistence : {};
  return Object.freeze({
    id: normalizeId(source.id, contextLabel),
    order: normalizeOrder(source.order),
    fields: Object.freeze(normalizeList(source.fields, `${contextLabel}.fields`)),
    validators: Object.freeze(normalizeList(source.validators, `${contextLabel}.validators`)),
    persistence: Object.freeze({
      read: persistenceSource.read ?? null,
      write: persistenceSource.write ?? null
    }),
    projection: source.projection ?? null
  });
}

function normalizeWorkerExtension(source, contextLabel) {
  assertPlainObject(source, contextLabel);
  assertKnownKeys(source, WORKER_EXTENSION_KEYS, contextLabel);

  const workerRuntimeSource = isPlainObject(source.workerRuntime) ? source.workerRuntime : {};
  return Object.freeze({
    id: normalizeId(source.id, contextLabel),
    order: normalizeOrder(source.order),
    workerRuntime: Object.freeze({
      concurrency: workerRuntimeSource.concurrency ?? null,
      lockHeldRequeueMax: workerRuntimeSource.lockHeldRequeueMax ?? null,
      retentionLockTtlMs: workerRuntimeSource.retentionLockTtlMs ?? null
    }),
    queues: Object.freeze(normalizeList(source.queues, `${contextLabel}.queues`)),
    processors: Object.freeze(normalizeList(source.processors, `${contextLabel}.processors`))
  });
}

function normalizeClientExtension(source, contextLabel) {
  assertPlainObject(source, contextLabel);
  assertKnownKeys(source, CLIENT_EXTENSION_KEYS, contextLabel);
  return Object.freeze({
    id: normalizeId(source.id, contextLabel),
    order: normalizeOrder(source.order),
    routeFragments: Object.freeze(normalizeList(source.routeFragments, `${contextLabel}.routeFragments`)),
    navigation: Object.freeze(normalizeList(source.navigation, `${contextLabel}.navigation`)),
    guardPolicies: Object.freeze(normalizeList(source.guardPolicies, `${contextLabel}.guardPolicies`)),
    realtimeInvalidation: Object.freeze(
      normalizeList(source.realtimeInvalidation, `${contextLabel}.realtimeInvalidation`)
    ),
    moduleContributions: Object.freeze(
      normalizeList(source.moduleContributions, `${contextLabel}.moduleContributions`)
    )
  });
}

function composeServerRuntimeBundle({ serverExtensions, settingsExtensions, workerExtensions }) {
  assertUniqueEntityIds(serverExtensions, (entry) => entry.routes, "route id", (entry) => entry.relativePath);
  assertUniqueEntityIds(
    settingsExtensions,
    (entry) => entry.fields,
    "settings field id",
    (entry) => entry.relativePath
  );
  assertUniqueEntityIds(workerExtensions, (entry) => entry.queues, "worker queue id", (entry) => entry.relativePath);
  assertUniqueEntityIds(
    workerExtensions,
    (entry) => entry.processors,
    "worker processor id",
    (entry) => entry.relativePath
  );

  const runtime = {
    routes: [],
    routePolicyOverrides: [],
    realtimeTopics: [],
    realtimePermissions: [],
    fastifyPlugins: [],
    backgroundRuntimes: [],
    diagnostics: [],
    settingsFields: [],
    settingsValidators: [],
    settingsPersistence: [],
    settingsProjection: [],
    workerRuntime: {
      concurrency: null,
      lockHeldRequeueMax: null,
      retentionLockTtlMs: null
    },
    queues: [],
    processors: []
  };

  for (const entry of serverExtensions) {
    runtime.routes.push(...entry.routes);
    runtime.routePolicyOverrides.push(...entry.routePolicyOverrides);
    runtime.realtimeTopics.push(...entry.realtimeTopics);
    runtime.realtimePermissions.push(...entry.realtimePermissions);
    runtime.fastifyPlugins.push(...entry.fastifyPlugins);
    runtime.backgroundRuntimes.push(...entry.backgroundRuntimes);
    runtime.diagnostics.push(...entry.diagnostics);
  }

  for (const entry of settingsExtensions) {
    runtime.settingsFields.push(...entry.fields);
    runtime.settingsValidators.push(...entry.validators);
    if (entry.persistence.read || entry.persistence.write) {
      runtime.settingsPersistence.push({ id: entry.id, persistence: entry.persistence });
    }
    if (entry.projection) {
      runtime.settingsProjection.push({ id: entry.id, projection: entry.projection });
    }
  }

  for (const entry of workerExtensions) {
    runtime.queues.push(...entry.queues);
    runtime.processors.push(...entry.processors);

    for (const key of Object.keys(runtime.workerRuntime)) {
      const value = entry.workerRuntime[key];
      if (value != null) {
        runtime.workerRuntime[key] = value;
      }
    }
  }

  return Object.freeze({
    server: Object.freeze(serverExtensions),
    settings: Object.freeze(settingsExtensions),
    workers: Object.freeze(workerExtensions),
    runtime: Object.freeze({
      routes: Object.freeze(runtime.routes),
      routePolicyOverrides: Object.freeze(runtime.routePolicyOverrides),
      realtimeTopics: Object.freeze(runtime.realtimeTopics),
      realtimePermissions: Object.freeze(runtime.realtimePermissions),
      fastifyPlugins: Object.freeze(runtime.fastifyPlugins),
      backgroundRuntimes: Object.freeze(runtime.backgroundRuntimes),
      diagnostics: Object.freeze(runtime.diagnostics),
      settingsFields: Object.freeze(runtime.settingsFields),
      settingsValidators: Object.freeze(runtime.settingsValidators),
      settingsPersistence: Object.freeze(runtime.settingsPersistence),
      settingsProjection: Object.freeze(runtime.settingsProjection),
      workerRuntime: Object.freeze(runtime.workerRuntime),
      queues: Object.freeze(runtime.queues),
      processors: Object.freeze(runtime.processors)
    })
  });
}

function normalizeClientSurface(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || DEFAULT_CLIENT_EXTENSION_SURFACE;
}

function loadClientAppDropinsFromModules({ modules = {} } = {}) {
  if (!isPlainObject(modules)) {
    throw new TypeError("loadClientAppDropinsFromModules requires modules object.");
  }

  const entries = [];
  for (const [filePath, sourceModule] of Object.entries(modules)) {
    if (!String(filePath).endsWith(CLIENT_EXTENSION_FILE_SUFFIX)) {
      continue;
    }
    const descriptor = sourceModule?.default ?? sourceModule;
    const normalized = normalizeClientExtension(descriptor, `client extension "${filePath}"`);
    entries.push(
      Object.freeze({
        ...normalized,
        filePath: String(filePath)
      })
    );
  }

  const sortedEntries = sortExtensions(entries, (entry) => entry.filePath);
  assertUniqueIds(sortedEntries, "client extension", (entry) => entry.filePath);

  assertUniqueEntityIds(
    sortedEntries,
    (entry) => entry.routeFragments.map((fragment) => ({
      id: `${normalizeClientSurface(fragment?.surface)}:${readEntityId(fragment)}`
    })),
    "route fragment id",
    (entry) => entry.filePath
  );
  assertUniqueEntityIds(
    sortedEntries,
    (entry) =>
      entry.navigation.map((navigationEntry) => ({
        id: `${normalizeClientSurface(navigationEntry?.surface)}:${readEntityId(navigationEntry)}`
      })),
    "navigation id",
    (entry) => entry.filePath
  );
  assertUniqueEntityIds(
    sortedEntries,
    (entry) => entry.guardPolicies,
    "guard policy id",
    (entry) => entry.filePath
  );

  const merged = {
    routeFragments: [],
    navigation: [],
    guardPolicies: [],
    realtimeInvalidation: [],
    moduleContributions: []
  };

  for (const entry of sortedEntries) {
    merged.routeFragments.push(...entry.routeFragments);
    merged.navigation.push(...entry.navigation);
    merged.guardPolicies.push(...entry.guardPolicies);
    merged.realtimeInvalidation.push(...entry.realtimeInvalidation);
    merged.moduleContributions.push(...entry.moduleContributions);
  }

  return Object.freeze({
    entries: Object.freeze(sortedEntries),
    routeFragments: Object.freeze(merged.routeFragments),
    navigation: Object.freeze(merged.navigation),
    guardPolicies: Object.freeze(merged.guardPolicies),
    realtimeInvalidation: Object.freeze(merged.realtimeInvalidation),
    moduleContributions: Object.freeze(merged.moduleContributions)
  });
}

function mergeClientValue(baseValue, contributionValue) {
  if (contributionValue == null) {
    return baseValue;
  }

  if (Array.isArray(baseValue) && Array.isArray(contributionValue)) {
    return [...baseValue, ...contributionValue];
  }

  if (isPlainObject(baseValue) && isPlainObject(contributionValue)) {
    const output = { ...baseValue };
    for (const [key, value] of Object.entries(contributionValue)) {
      output[key] = mergeClientValue(baseValue[key], value);
    }
    return output;
  }

  return contributionValue;
}

function mergeClientModuleRegistry({ baseRegistry = [], extensionBundle }) {
  if (!Array.isArray(baseRegistry)) {
    throw new TypeError("mergeClientModuleRegistry requires baseRegistry array.");
  }

  const registry = baseRegistry.map((entry) =>
    Object.freeze({
      ...entry,
      client: isPlainObject(entry?.client) ? Object.freeze(mergeClientValue({}, entry.client)) : entry?.client
    })
  );

  if (!extensionBundle || !Array.isArray(extensionBundle.entries)) {
    return Object.freeze(registry);
  }

  for (const extensionEntry of extensionBundle.entries) {
    for (const contribution of extensionEntry.moduleContributions) {
      if (!isPlainObject(contribution)) {
        throw new TypeError(`Client extension "${extensionEntry.id}" includes a non-object module contribution.`);
      }

      const moduleId = String(contribution.moduleId || contribution.id || "").trim();
      if (!moduleId) {
        throw new TypeError(
          `Client extension "${extensionEntry.id}" module contribution must define moduleId.`
        );
      }

      if (!isPlainObject(contribution.client)) {
        throw new TypeError(
          `Client extension "${extensionEntry.id}" module "${moduleId}" must provide client object.`
        );
      }

      const existingIndex = registry.findIndex((entry) => entry.id === moduleId);
      if (existingIndex < 0) {
        throw new TypeError(
          `Client extension "${extensionEntry.id}" module "${moduleId}" must reference an existing module.`
        );
      }

      const existing = registry[existingIndex];
      registry[existingIndex] = Object.freeze({
        ...existing,
        client: Object.freeze(mergeClientValue(existing.client, contribution.client))
      });
    }
  }

  return Object.freeze(registry);
}

const __testables = {
  normalizeServerExtension,
  normalizeSettingsExtension,
  normalizeWorkerExtension,
  normalizeClientExtension,
  normalizeServerDropinChannel,
  resolveServerDropinChannels,
  sortExtensions,
  composeServerRuntimeBundle,
  mergeClientValue
};

export {
  SERVER_EXTENSION_FILE_SUFFIX,
  toPosix,
  sortExtensions,
  assertUniqueIds,
  resolveServerDropinChannels,
  normalizeServerExtension,
  normalizeSettingsExtension,
  normalizeWorkerExtension,
  composeServerRuntimeBundle,
  loadClientAppDropinsFromModules,
  mergeClientModuleRegistry,
  __testables
};
