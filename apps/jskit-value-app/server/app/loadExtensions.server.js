import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ORDER = 100;
const DEFAULT_APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_EXTENSION_FILE_SUFFIX = ".server.js";

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

const DEFAULT_SERVER_EXTENSION = Object.freeze({
  routes: Object.freeze([]),
  routePolicyOverrides: Object.freeze([]),
  realtimeTopics: Object.freeze([]),
  realtimePermissions: Object.freeze([]),
  fastifyPlugins: Object.freeze([]),
  backgroundRuntimes: Object.freeze([]),
  diagnostics: Object.freeze([])
});

const DEFAULT_SETTINGS_EXTENSION = Object.freeze({
  fields: Object.freeze([]),
  validators: Object.freeze([]),
  persistence: Object.freeze({
    read: null,
    write: null
  }),
  projection: null
});

const DEFAULT_WORKER_EXTENSION = Object.freeze({
  workerRuntime: Object.freeze({
    concurrency: null,
    lockHeldRequeueMax: null,
    retentionLockTtlMs: null
  }),
  queues: Object.freeze([]),
  processors: Object.freeze([])
});

function toPosix(value) {
  return String(value || "").replaceAll(path.sep, "/");
}

function assertPlainObject(value, contextLabel) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

function sortExtensions(entries) {
  return entries
    .slice()
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.fileName.localeCompare(right.fileName) ||
        left.id.localeCompare(right.id)
    );
}

function assertUniqueIds(entries, familyLabel) {
  const seen = new Map();
  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      seen.set(entry.id, entry.relativePath);
      continue;
    }
    throw new Error(
      `${familyLabel} id "${entry.id}" is duplicated (${seen.get(entry.id)} and ${entry.relativePath}).`
    );
  }
}

function extractEntityId(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return String(value.id || "").trim();
  }
  return "";
}

function assertUniqueEntityIds(entries, selector, label) {
  const seen = new Map();
  for (const entry of entries) {
    const ids = selector(entry);
    for (const id of ids) {
      if (!id) {
        continue;
      }
      if (!seen.has(id)) {
        seen.set(id, entry.relativePath);
        continue;
      }
      throw new Error(`${label} "${id}" is duplicated (${seen.get(id)} and ${entry.relativePath}).`);
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

  const persistenceSource =
    source.persistence && typeof source.persistence === "object" && !Array.isArray(source.persistence)
      ? source.persistence
      : {};

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

  const workerRuntimeSource =
    source.workerRuntime && typeof source.workerRuntime === "object" && !Array.isArray(source.workerRuntime)
      ? source.workerRuntime
      : {};

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

async function readExtensionFiles(directoryPath) {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(SERVER_EXTENSION_FILE_SUFFIX))
    .map((entry) => ({
      fileName: entry.name,
      filePath: path.join(directoryPath, entry.name)
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

async function loadExtensionFamily({ appDir, directoryName, familyLabel, normalizer }) {
  const directoryPath = path.join(appDir, directoryName);
  const files = await readExtensionFiles(directoryPath);
  const loaded = [];

  for (const file of files) {
    const imported = await import(pathToFileURL(file.filePath).href);
    const descriptor = imported?.default ?? imported;
    const contextLabel = `${familyLabel} extension "${toPosix(path.relative(appDir, file.filePath))}"`;
    const normalized = normalizer(descriptor, contextLabel);
    loaded.push(
      Object.freeze({
        ...normalized,
        fileName: file.fileName,
        filePath: file.filePath,
        relativePath: toPosix(path.relative(appDir, file.filePath))
      })
    );
  }

  const sorted = sortExtensions(loaded);
  assertUniqueIds(sorted, familyLabel);
  return Object.freeze(sorted);
}

function composeServerExtensionsBundle({ serverExtensions, settingsExtensions, workerExtensions }) {
  assertUniqueEntityIds(
    serverExtensions,
    (entry) => entry.routes.map((route) => extractEntityId(route)).filter(Boolean),
    "route id"
  );
  assertUniqueEntityIds(
    settingsExtensions,
    (entry) => entry.fields.map((field) => extractEntityId(field)).filter(Boolean),
    "settings field id"
  );
  assertUniqueEntityIds(
    workerExtensions,
    (entry) => entry.queues.map((queue) => extractEntityId(queue)).filter(Boolean),
    "worker queue id"
  );
  assertUniqueEntityIds(
    workerExtensions,
    (entry) => entry.processors.map((processor) => extractEntityId(processor)).filter(Boolean),
    "worker processor id"
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
      runtime.settingsPersistence.push({
        id: entry.id,
        persistence: entry.persistence
      });
    }
    if (entry.projection) {
      runtime.settingsProjection.push({
        id: entry.id,
        projection: entry.projection
      });
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

async function loadServerAppExtensions({ appDir = DEFAULT_APP_DIR } = {}) {
  const serverExtensions = await loadExtensionFamily({
    appDir,
    directoryName: "extensions.d",
    familyLabel: "server",
    normalizer: normalizeServerExtension
  });

  const settingsExtensions = await loadExtensionFamily({
    appDir,
    directoryName: "settings.extensions.d",
    familyLabel: "settings",
    normalizer: normalizeSettingsExtension
  });

  const workerExtensions = await loadExtensionFamily({
    appDir,
    directoryName: "workers.extensions.d",
    familyLabel: "worker",
    normalizer: normalizeWorkerExtension
  });

  return composeServerExtensionsBundle({
    serverExtensions,
    settingsExtensions,
    workerExtensions
  });
}

const __testables = {
  DEFAULT_APP_DIR,
  normalizeServerExtension,
  normalizeSettingsExtension,
  normalizeWorkerExtension,
  sortExtensions,
  composeServerExtensionsBundle
};

export {
  DEFAULT_SERVER_EXTENSION,
  DEFAULT_SETTINGS_EXTENSION,
  DEFAULT_WORKER_EXTENSION,
  loadServerAppExtensions,
  __testables
};
