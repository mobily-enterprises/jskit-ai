const DEFAULT_ORDER = 100;
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

function assertPlainObject(value, contextLabel) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${contextLabel} must export an object.`);
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

function normalizeArray(value, contextLabel) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${contextLabel} must be an array.`);
  }
  return value.slice();
}

function assertKnownKeys(value, contextLabel) {
  for (const key of Object.keys(value)) {
    if (!CLIENT_EXTENSION_KEYS.has(key)) {
      throw new TypeError(`${contextLabel} uses unsupported key "${key}".`);
    }
  }
}

function resolveClientExtensionModules({ modules } = {}) {
  if (modules && typeof modules === "object" && !Array.isArray(modules)) {
    return modules;
  }

  if (typeof import.meta.glob === "function") {
    return import.meta.glob("./extensions.d/*.client.js", { eager: true });
  }

  return {};
}

function sortExtensions(entries) {
  return entries
    .slice()
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.filePath.localeCompare(right.filePath) ||
        left.id.localeCompare(right.id)
    );
}

function normalizeEntry(rawModule, filePath) {
  const descriptor = rawModule?.default ?? rawModule;
  const contextLabel = `client extension "${filePath}"`;
  assertPlainObject(descriptor, contextLabel);
  assertKnownKeys(descriptor, contextLabel);

  return Object.freeze({
    id: normalizeId(descriptor.id, contextLabel),
    order: normalizeOrder(descriptor.order),
    routeFragments: Object.freeze(normalizeArray(descriptor.routeFragments, `${contextLabel}.routeFragments`)),
    navigation: Object.freeze(normalizeArray(descriptor.navigation, `${contextLabel}.navigation`)),
    guardPolicies: Object.freeze(normalizeArray(descriptor.guardPolicies, `${contextLabel}.guardPolicies`)),
    realtimeInvalidation: Object.freeze(
      normalizeArray(descriptor.realtimeInvalidation, `${contextLabel}.realtimeInvalidation`)
    ),
    moduleContributions: Object.freeze(
      normalizeArray(descriptor.moduleContributions, `${contextLabel}.moduleContributions`)
    ),
    filePath
  });
}

function assertUniqueExtensionIds(entries) {
  const seen = new Map();
  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      seen.set(entry.id, entry.filePath);
      continue;
    }
    throw new Error(`Duplicate client extension id "${entry.id}" (${seen.get(entry.id)} and ${entry.filePath}).`);
  }
}

function pickSurface(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "app";
}

function collectObjectId(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return String(value.id || "").trim();
  }
  return "";
}

function assertUniqueBy(entries, listSelector, keySelector, label) {
  const seen = new Map();
  for (const entry of entries) {
    for (const item of listSelector(entry)) {
      const key = keySelector(item);
      if (!key) {
        continue;
      }
      if (!seen.has(key)) {
        seen.set(key, entry.filePath);
        continue;
      }
      throw new Error(`${label} "${key}" is duplicated (${seen.get(key)} and ${entry.filePath}).`);
    }
  }
}

function composeClientExtensions(entries) {
  assertUniqueBy(
    entries,
    (entry) => entry.routeFragments,
    (fragment) => {
      const id = collectObjectId(fragment);
      if (!id) {
        return "";
      }
      const surface = pickSurface(fragment?.surface);
      return `${surface}:${id}`;
    },
    "route fragment id"
  );
  assertUniqueBy(
    entries,
    (entry) => entry.navigation,
    (navigationEntry) => {
      const id = collectObjectId(navigationEntry);
      if (!id) {
        return "";
      }
      const surface = pickSurface(navigationEntry?.surface);
      return `${surface}:${id}`;
    },
    "navigation id"
  );
  assertUniqueBy(
    entries,
    (entry) => entry.guardPolicies,
    (policy) => collectObjectId(policy),
    "guard policy id"
  );

  const merged = {
    routeFragments: [],
    navigation: [],
    guardPolicies: [],
    realtimeInvalidation: [],
    moduleContributions: []
  };

  for (const entry of entries) {
    merged.routeFragments.push(...entry.routeFragments);
    merged.navigation.push(...entry.navigation);
    merged.guardPolicies.push(...entry.guardPolicies);
    merged.realtimeInvalidation.push(...entry.realtimeInvalidation);
    merged.moduleContributions.push(...entry.moduleContributions);
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    routeFragments: Object.freeze(merged.routeFragments),
    navigation: Object.freeze(merged.navigation),
    guardPolicies: Object.freeze(merged.guardPolicies),
    realtimeInvalidation: Object.freeze(merged.realtimeInvalidation),
    moduleContributions: Object.freeze(merged.moduleContributions)
  });
}

function loadClientAppExtensions({ modules } = {}) {
  const moduleMap = resolveClientExtensionModules({ modules });
  const entries = Object.entries(moduleMap).map(([filePath, value]) => normalizeEntry(value, filePath));
  const sorted = sortExtensions(entries);
  assertUniqueExtensionIds(sorted);
  return composeClientExtensions(sorted);
}

let cachedClientExtensions = null;

function getClientAppExtensions() {
  if (!cachedClientExtensions) {
    cachedClientExtensions = loadClientAppExtensions();
  }
  return cachedClientExtensions;
}

const __testables = {
  normalizeEntry,
  sortExtensions,
  composeClientExtensions,
  resetClientAppExtensionsCache() {
    cachedClientExtensions = null;
  }
};

export { loadClientAppExtensions, getClientAppExtensions, __testables };
