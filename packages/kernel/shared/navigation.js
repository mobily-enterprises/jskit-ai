import {
  isRecord,
  measureUtf8Bytes,
  normalizeOptionalText,
  normalizeOptionalStrictText,
  normalizeRequiredText
} from "./navigationInternals.js";

const JSKIT_NAVIGATION_SCHEMA_VERSION = 1;

const JSKIT_ROUTE_NAVIGATION_BEHAVIORS = Object.freeze([
  "destination",
  "preserve",
  "boundary"
]);

const JSKIT_NAVIGATION_SCOPE_FIELDS = Object.freeze([
  "principal",
  "surface",
  "workspace",
  "tenant"
]);

const DEFAULT_JSKIT_NAVIGATION_LIMITS = Object.freeze({
  maxEntries: 50,
  maxSnapshotBytes: 64 * 1024,
  maxTaskBytes: 1024 * 1024,
  maxObjectDepth: 12,
  maxObjectKeys: 1000,
  ttlMs: 12 * 60 * 60 * 1000,
  contributorRegistrationTimeoutMs: 1500,
  dataReadyTimeoutMs: 5000,
  focusTimeoutMs: 1000
});

const HARD_JSKIT_NAVIGATION_LIMITS = Object.freeze({
  maxEntries: 250,
  maxSnapshotBytes: 256 * 1024,
  maxTaskBytes: 5 * 1024 * 1024,
  maxObjectDepth: 32,
  maxObjectKeys: 10000,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  contributorRegistrationTimeoutMs: 30000,
  dataReadyTimeoutMs: 30000,
  focusTimeoutMs: 10000
});

const HISTORY_ENTRY_KINDS = new Set(["destination", "machinery", "boundary"]);
const PERSISTENCE_MODES = new Set(["none", "url-only", "snapshot"]);
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

function hasAsciiControlCharacter(value) {
  for (const character of String(value ?? "")) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function isPlainRecord(value) {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createJskitNavigationLimits(overrides = {}) {
  if (!isRecord(overrides)) {
    throw new TypeError("JSKIT navigation limits must be an object.");
  }

  const limits = {};
  for (const [field, defaultValue] of Object.entries(DEFAULT_JSKIT_NAVIGATION_LIMITS)) {
    const candidate = Object.hasOwn(overrides, field) ? Number(overrides[field]) : defaultValue;
    if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || candidate < 1) {
      throw new RangeError(`JSKIT navigation limit ${field} must be a positive finite integer.`);
    }
    if (candidate > HARD_JSKIT_NAVIGATION_LIMITS[field]) {
      throw new RangeError(
        `JSKIT navigation limit ${field} exceeds the hard ceiling of ${HARD_JSKIT_NAVIGATION_LIMITS[field]}.`
      );
    }
    limits[field] = candidate;
  }
  return Object.freeze(limits);
}

function normalizeNavigationPersistence(value) {
  if (!isRecord(value)) {
    throw new TypeError("navigation.persistence must be an object.");
  }
  const mode = normalizeRequiredText(value.mode, "navigation.persistence.mode").toLowerCase();
  if (!PERSISTENCE_MODES.has(mode)) {
    throw new TypeError(`Unsupported navigation persistence mode "${mode}".`);
  }
  const queryAllowlist = Array.isArray(value.queryAllowlist)
    ? Object.freeze(
        Array.from(
          new Set(value.queryAllowlist.map((entry) => String(entry ?? "").trim()).filter(Boolean))
        )
      )
    : undefined;
  const sanitizer = normalizeOptionalText(value.sanitizer);
  return Object.freeze({
    mode,
    ...(queryAllowlist ? { queryAllowlist } : {}),
    ...(sanitizer ? { sanitizer } : {})
  });
}

function normalizeNavigationTargetQuery(value) {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new TypeError("navigation target query must be an object.");
  }
  const query = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) {
      continue;
    }
    if (entry == null) {
      query[normalizedKey] = entry;
      continue;
    }
    if (Array.isArray(entry)) {
      if (!entry.every((item) => typeof item === "string")) {
        throw new TypeError(`navigation target query field "${normalizedKey}" must contain strings.`);
      }
      query[normalizedKey] = [...entry];
      continue;
    }
    if (typeof entry === "string") {
      query[normalizedKey] = entry;
      continue;
    }
    throw new TypeError(`navigation target query field "${normalizedKey}" is not serializable.`);
  }
  return Object.freeze(query);
}

function normalizeNavigationTargetParams(value) {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new TypeError("navigation target params must be an object.");
  }
  const params = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key).trim();
    if (
      !normalizedKey ||
      !["string", "number"].includes(typeof entry) ||
      (typeof entry === "number" && !Number.isFinite(entry))
    ) {
      throw new TypeError(`navigation target param "${normalizedKey || key}" must be a string or number.`);
    }
    params[normalizedKey] = entry;
  }
  return Object.freeze(params);
}

function normalizeJskitNavigationTarget(value) {
  if (typeof value === "string") {
    return Object.freeze({ path: normalizeJskitInternalFullPath(value) });
  }
  if (!isRecord(value)) {
    throw new TypeError("JSKIT navigation target must be an internal path or route target object.");
  }

  const name = normalizeOptionalStrictText(value.name, "navigation target name");
  const path = normalizeOptionalStrictText(value.path, "navigation target path");
  if (!name && !path) {
    throw new TypeError("JSKIT navigation target requires route name or path.");
  }
  const normalizedPath = path ? normalizeJskitInternalFullPath(path) : undefined;
  const params = normalizeNavigationTargetParams(value.params);
  const query = normalizeNavigationTargetQuery(value.query);
  const hash = normalizeOptionalStrictText(value.hash, "navigation target hash");
  if (hash && !hash.startsWith("#")) {
    throw new TypeError("navigation target hash must start with #.");
  }

  return Object.freeze({
    ...(name ? { name } : {}),
    ...(normalizedPath ? { path: normalizedPath } : {}),
    ...(params ? { params } : {}),
    ...(query ? { query } : {}),
    ...(hash ? { hash } : {})
  });
}

function normalizeMatchedNavigationRecord(value) {
  if (!isRecord(value)) {
    throw new TypeError("route meta jskit.navigation must be an object.");
  }
  const normalized = {};

  if (Object.hasOwn(value, "behavior")) {
    const behavior = normalizeRequiredText(value.behavior, "navigation.behavior").toLowerCase();
    if (!JSKIT_ROUTE_NAVIGATION_BEHAVIORS.includes(behavior)) {
      throw new TypeError(`Unsupported route navigation behavior "${behavior}".`);
    }
    normalized.behavior = behavior;
  }
  for (const field of ["destinationKey", "machineryKey", "labelKey"]) {
    if (Object.hasOwn(value, field)) {
      normalized[field] = normalizeOptionalStrictText(value[field], `navigation.${field}`);
    }
  }
  if (Object.hasOwn(value, "fallback")) {
    normalized.fallback =
      typeof value.fallback === "string"
        ? normalizeRequiredText(value.fallback, "navigation.fallback")
        : normalizeJskitNavigationTarget(value.fallback);
  }
  if (Object.hasOwn(value, "restore")) {
    if (!Array.isArray(value.restore)) {
      throw new TypeError("navigation.restore must be an array.");
    }
    normalized.restore = Object.freeze(
      Array.from(new Set(value.restore.map((entry) => String(entry ?? "").trim()).filter(Boolean)))
    );
  }
  if (Object.hasOwn(value, "scope")) {
    if (!Array.isArray(value.scope)) {
      throw new TypeError("navigation.scope must be an array.");
    }
    const scope = Array.from(
      new Set(value.scope.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean))
    );
    for (const field of scope) {
      if (!JSKIT_NAVIGATION_SCOPE_FIELDS.includes(field)) {
        throw new TypeError(`Unsupported navigation scope field "${field}".`);
      }
    }
    normalized.scope = Object.freeze(scope);
  }
  if (Object.hasOwn(value, "persistence")) {
    normalized.persistence = normalizeNavigationPersistence(value.persistence);
  }
  return normalized;
}

function validateJskitRouteNavigationMeta(meta) {
  const normalized = normalizeMatchedNavigationRecord(meta);
  if (!normalized.behavior) {
    throw new TypeError("route navigation metadata requires behavior.");
  }
  if (normalized.behavior === "destination" && !normalized.destinationKey) {
    throw new TypeError("destination route navigation metadata requires destinationKey.");
  }
  if (normalized.behavior === "preserve" && !normalized.machineryKey) {
    throw new TypeError("preserve route navigation metadata requires machineryKey.");
  }
  if (normalized.behavior !== "destination" && normalized.destinationKey) {
    throw new TypeError(`${normalized.behavior} route navigation metadata must not declare destinationKey.`);
  }
  if (normalized.behavior !== "preserve" && normalized.machineryKey) {
    throw new TypeError(`${normalized.behavior} route navigation metadata must not declare machineryKey.`);
  }
  return Object.freeze(normalized);
}

function resolveJskitRouteNavigationMeta(route) {
  const matched = Array.isArray(route?.matched) ? route.matched : [];
  const resolved = {};
  for (const record of matched) {
    const candidate = record?.meta?.jskit?.navigation;
    if (!isRecord(candidate)) {
      continue;
    }
    const normalized = normalizeMatchedNavigationRecord(candidate);
    if (normalized.behavior && normalized.behavior !== resolved.behavior) {
      if (!Object.hasOwn(normalized, "destinationKey")) {
        delete resolved.destinationKey;
      }
      if (!Object.hasOwn(normalized, "machineryKey")) {
        delete resolved.machineryKey;
      }
    }
    for (const [field, value] of Object.entries(normalized)) {
      resolved[field] = value;
    }
  }

  if (!resolved.behavior) {
    return null;
  }
  return validateJskitRouteNavigationMeta(resolved);
}

function normalizeRouterBase(value) {
  const base = String(value || "/").trim() || "/";
  if (!base.startsWith("/") || base.startsWith("//")) {
    throw new TypeError("router base must be an absolute same-origin path.");
  }
  return base === "/" ? base : `/${base.split("/").filter(Boolean).join("/")}/`;
}

function normalizeJskitInternalFullPath(value, { base = "/" } = {}) {
  const candidate = String(value ?? "").trim();
  if (!candidate || hasAsciiControlCharacter(candidate) || candidate.includes("\\")) {
    throw new TypeError("Navigation location must be a nonempty internal path without control characters.");
  }
  if (SCHEME_PATTERN.test(candidate) || candidate.startsWith("//") || !candidate.startsWith("/")) {
    throw new TypeError("Navigation location must be a same-origin internal path.");
  }

  let decoded;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    throw new TypeError("Navigation location contains malformed percent encoding.");
  }
  if (hasAsciiControlCharacter(decoded) || decoded.includes("\\") || decoded.startsWith("//")) {
    throw new TypeError("Navigation location contains an unsafe encoded path.");
  }

  const normalizedBase = normalizeRouterBase(base);
  const origin = "https://jskit.invalid";
  const url = new URL(candidate, origin);
  if (url.origin !== origin) {
    throw new TypeError("Navigation location must remain on the application origin.");
  }
  if (normalizedBase !== "/" && url.pathname !== normalizedBase.slice(0, -1) && !url.pathname.startsWith(normalizedBase)) {
    throw new TypeError(`Navigation location escapes router base "${normalizedBase}".`);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function isSafeJskitInternalFullPath(value, options) {
  try {
    normalizeJskitInternalFullPath(value, options);
    return true;
  } catch {
    return false;
  }
}

function normalizeJskitNavigationScope(value = {}) {
  if (!isRecord(value)) {
    throw new TypeError("JSKIT navigation scope must be an object.");
  }
  const scope = {};
  for (const field of JSKIT_NAVIGATION_SCOPE_FIELDS) {
    const normalized = normalizeOptionalStrictText(value[field], `navigation scope ${field}`);
    if (normalized) {
      scope[field] = normalized;
    }
  }
  return Object.freeze(scope);
}

function jskitNavigationScopesMatch(storedScope, currentScope, requiredFields = JSKIT_NAVIGATION_SCOPE_FIELDS) {
  const stored = normalizeJskitNavigationScope(storedScope);
  const current = normalizeJskitNavigationScope(currentScope);
  const fields = Array.isArray(requiredFields) ? requiredFields : [];
  return fields.every((field) => {
    if (!JSKIT_NAVIGATION_SCOPE_FIELDS.includes(field)) {
      return false;
    }
    return stored[field] !== undefined && stored[field] === current[field];
  });
}

function normalizeJskitSerializableValue(value, options = {}) {
  const limits = createJskitNavigationLimits(options.limits || {});
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : limits.maxSnapshotBytes;
  if (
    !Number.isFinite(maxBytes) ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > HARD_JSKIT_NAVIGATION_LIMITS.maxTaskBytes
  ) {
    throw new RangeError("Serializable value maxBytes is invalid.");
  }

  const seen = new WeakSet();
  let objectKeys = 0;

  function visit(entry, depth) {
    if (depth > limits.maxObjectDepth) {
      throw new RangeError(`Serializable value exceeds maximum depth ${limits.maxObjectDepth}.`);
    }
    if (entry == null || typeof entry === "string" || typeof entry === "boolean") {
      return entry;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        throw new TypeError("Serializable value contains a non-finite number.");
      }
      return entry;
    }
    if (["function", "symbol", "bigint", "undefined"].includes(typeof entry)) {
      throw new TypeError(`Serializable value contains unsupported ${typeof entry} data.`);
    }
    if (typeof entry !== "object") {
      throw new TypeError("Serializable value contains unsupported data.");
    }
    if (seen.has(entry)) {
      throw new TypeError("Serializable value contains a cycle.");
    }
    seen.add(entry);

    let normalized;
    if (Array.isArray(entry)) {
      normalized = entry.map((item) => visit(item, depth + 1));
    } else {
      if (!isPlainRecord(entry)) {
        throw new TypeError("Serializable value contains a class or DOM-like object without a serializer.");
      }
      normalized = {};
      const keys = Object.keys(entry);
      objectKeys += keys.length;
      if (objectKeys > limits.maxObjectKeys) {
        throw new RangeError(`Serializable value exceeds maximum key count ${limits.maxObjectKeys}.`);
      }
      for (const key of keys) {
        normalized[key] = visit(entry[key], depth + 1);
      }
    }
    seen.delete(entry);
    return normalized;
  }

  const normalized = visit(value, 0);
  const encoded = JSON.stringify(normalized);
  if (measureUtf8Bytes(encoded) > maxBytes) {
    throw new RangeError(`Serializable value exceeds maximum byte size ${maxBytes}.`);
  }
  return normalized;
}

function createJskitNavigationResolverRegistry() {
  const fallbacks = new Map();
  const sanitizers = new Map();

  function register(map, token, resolver, kind) {
    const normalizedToken = normalizeRequiredText(token, `${kind} resolver token`);
    if (typeof resolver !== "function") {
      throw new TypeError(`${kind} resolver "${normalizedToken}" must be a function.`);
    }
    if (map.has(normalizedToken)) {
      throw new Error(`${kind} resolver token "${normalizedToken}" is already registered.`);
    }
    map.set(normalizedToken, resolver);
    return () => {
      if (map.get(normalizedToken) === resolver) {
        map.delete(normalizedToken);
      }
    };
  }

  return Object.freeze({
    registerFallback(token, resolver) {
      return register(fallbacks, token, resolver, "Fallback");
    },
    registerSanitizer(token, sanitizer) {
      return register(sanitizers, token, sanitizer, "Sanitizer");
    },
    resolveFallback(token) {
      return fallbacks.get(String(token ?? "").trim());
    },
    resolveSanitizer(token) {
      return sanitizers.get(String(token ?? "").trim());
    }
  });
}

function readJskitHistoryNavigationEnvelope(state) {
  const candidate = state?.__jskit?.navigation;
  if (!isRecord(candidate) || candidate.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION) {
    return null;
  }
  const kind = String(candidate.kind || "").trim();
  const taskId = normalizeOptionalText(candidate.taskId);
  const browserEntryId = normalizeOptionalText(candidate.browserEntryId);
  const sequence = Number(candidate.sequence);
  if (!taskId || !browserEntryId || !HISTORY_ENTRY_KINDS.has(kind) || !Number.isInteger(sequence) || sequence < 0) {
    return null;
  }
  const destinationEntryId = normalizeOptionalText(candidate.destinationEntryId);
  const destinationKey = normalizeOptionalText(candidate.destinationKey);
  const machineryKey = normalizeOptionalText(candidate.machineryKey);
  const previousJskitBrowserEntryId = normalizeOptionalText(candidate.previousJskitBrowserEntryId);
  const snapshotRef = normalizeOptionalText(candidate.snapshotRef);
  if (kind === "destination" && (!destinationEntryId || !destinationKey)) {
    return null;
  }
  if (kind === "machinery" && !machineryKey) {
    return null;
  }
  if (kind === "boundary" && (destinationEntryId || destinationKey || machineryKey)) {
    return null;
  }
  return Object.freeze({
    schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
    taskId,
    browserEntryId,
    sequence,
    kind,
    ...(destinationEntryId ? { destinationEntryId } : {}),
    ...(previousJskitBrowserEntryId ? { previousJskitBrowserEntryId } : {}),
    ...(destinationKey ? { destinationKey } : {}),
    ...(machineryKey ? { machineryKey } : {}),
    ...(snapshotRef ? { snapshotRef } : {})
  });
}

function mergeJskitHistoryNavigationEnvelope(state, envelope) {
  const current = isRecord(state) ? state : {};
  const currentJskit = isRecord(current.__jskit) ? current.__jskit : {};
  return {
    ...current,
    __jskit: {
      ...currentJskit,
      navigation: envelope
    }
  };
}

function createEmptyJskitNavigationTask(taskId) {
  return Object.freeze({
    schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
    taskId: normalizeRequiredText(taskId, "navigation task id"),
    browserEntries: Object.freeze({}),
    destinations: Object.freeze({}),
    activeBrowserEntryId: ""
  });
}

function reduceJskitNavigationTask(task, event) {
  if (!isRecord(task) || task.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION) {
    throw new TypeError("reduceJskitNavigationTask requires a v1 task.");
  }
  if (!isRecord(event)) {
    throw new TypeError("reduceJskitNavigationTask requires an event.");
  }
  const now = Number.isFinite(event.now) ? Number(event.now) : Date.now();
  const browserEntries = { ...(task.browserEntries || {}) };
  const destinations = { ...(task.destinations || {}) };
  let activeBrowserEntryId = String(task.activeBrowserEntryId || "");

  if (event.type === "commit") {
    const entry = event.browserEntry;
    if (!isRecord(entry) || entry.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION) {
      throw new TypeError("navigation commit requires a v1 browser entry.");
    }
    const browserEntryId = normalizeRequiredText(entry.browserEntryId, "browser entry id");
    if (entry.taskId !== task.taskId) {
      throw new Error("navigation browser entry task does not match the task ledger.");
    }
    browserEntries[browserEntryId] = Object.freeze({ entry: Object.freeze({ ...entry }), lastSeenAt: now });
    if (event.destinationEntry) {
      const destinationEntry = event.destinationEntry;
      if (destinationEntry.taskId !== task.taskId) {
        throw new Error("navigation destination task does not match the task ledger.");
      }
      const destinationEntryId = normalizeRequiredText(destinationEntry.destinationEntryId, "destination entry id");
      destinations[destinationEntryId] = Object.freeze({
        entry: Object.freeze({ ...destinationEntry }),
        lastSeenAt: now
      });
    }
    activeBrowserEntryId = browserEntryId;
  } else if (event.type === "write-destination") {
    const destinationEntry = event.destinationEntry;
    if (!isRecord(destinationEntry) || destinationEntry.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION) {
      throw new TypeError("navigation destination write requires a v1 destination entry.");
    }
    if (destinationEntry.taskId !== task.taskId) {
      throw new Error("navigation destination task does not match the task ledger.");
    }
    const destinationEntryId = normalizeRequiredText(destinationEntry.destinationEntryId, "destination entry id");
    destinations[destinationEntryId] = Object.freeze({
      entry: Object.freeze({ ...destinationEntry }),
      lastSeenAt: now
    });
  } else if (event.type === "activate") {
    const browserEntryId = normalizeRequiredText(event.browserEntryId, "browser entry id");
    if (!browserEntries[browserEntryId]) {
      throw new Error(`Cannot activate unknown navigation browser entry "${browserEntryId}".`);
    }
    browserEntries[browserEntryId] = Object.freeze({
      ...browserEntries[browserEntryId],
      lastSeenAt: now
    });
    activeBrowserEntryId = browserEntryId;
  } else if (event.type === "remove-destination") {
    const destinationEntryId = normalizeRequiredText(event.destinationEntryId, "destination entry id");
    delete destinations[destinationEntryId];
  } else {
    throw new TypeError(`Unsupported navigation reducer event "${String(event.type || "")}".`);
  }

  return Object.freeze({
    schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
    taskId: task.taskId,
    browserEntries: Object.freeze(browserEntries),
    destinations: Object.freeze(destinations),
    activeBrowserEntryId
  });
}

function projectJskitNavigationTask(task) {
  if (!isRecord(task) || task.schema !== JSKIT_NAVIGATION_SCHEMA_VERSION) {
    return Object.freeze({ browserTrail: Object.freeze([]), destinationTrail: Object.freeze([]), canPop: false });
  }
  const browserTrail = [];
  const destinationTrail = [];
  const seenBrowserEntries = new Set();
  let browserEntryId = String(task.activeBrowserEntryId || "");

  while (browserEntryId && !seenBrowserEntries.has(browserEntryId)) {
    seenBrowserEntries.add(browserEntryId);
    const browserRecord = task.browserEntries?.[browserEntryId];
    const entry = browserRecord?.entry;
    if (!isRecord(entry) || entry.taskId !== task.taskId) {
      break;
    }
    browserTrail.push(entry);
    if (entry.destinationEntryId) {
      const destination = task.destinations?.[entry.destinationEntryId]?.entry;
      if (isRecord(destination) && destination.taskId === task.taskId) {
        destinationTrail.push(destination);
      }
    }
    browserEntryId = String(entry.previousJskitBrowserEntryId || "");
  }

  const current = browserTrail[0] || null;
  const predecessorId = String(current?.previousJskitBrowserEntryId || "");
  const predecessor = predecessorId ? task.browserEntries?.[predecessorId]?.entry : null;
  const canPop = Boolean(predecessor && predecessor.taskId === task.taskId);
  return Object.freeze({
    browserTrail: Object.freeze(browserTrail),
    destinationTrail: Object.freeze(destinationTrail),
    canPop
  });
}

export {
  JSKIT_NAVIGATION_SCHEMA_VERSION,
  JSKIT_ROUTE_NAVIGATION_BEHAVIORS,
  JSKIT_NAVIGATION_SCOPE_FIELDS,
  DEFAULT_JSKIT_NAVIGATION_LIMITS,
  HARD_JSKIT_NAVIGATION_LIMITS,
  createJskitNavigationLimits,
  normalizeJskitNavigationTarget,
  validateJskitRouteNavigationMeta,
  resolveJskitRouteNavigationMeta,
  normalizeJskitInternalFullPath,
  isSafeJskitInternalFullPath,
  normalizeJskitNavigationScope,
  jskitNavigationScopesMatch,
  normalizeJskitSerializableValue,
  createJskitNavigationResolverRegistry,
  readJskitHistoryNavigationEnvelope,
  mergeJskitHistoryNavigationEnvelope,
  createEmptyJskitNavigationTask,
  reduceJskitNavigationTask,
  projectJskitNavigationTask
};
