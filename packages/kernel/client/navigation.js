import {
  computed,
  inject,
  onScopeDispose,
  readonly,
  shallowReactive,
} from "vue";
import {
  JSKIT_NAVIGATION_SCHEMA_VERSION,
  JSKIT_NAVIGATION_SCOPE_FIELDS,
  createJskitNavigationLimits,
  createJskitNavigationResolverRegistry,
  jskitNavigationScopesMatch,
  mergeJskitHistoryNavigationEnvelope,
  normalizeJskitInternalFullPath,
  normalizeJskitNavigationScope,
  normalizeJskitNavigationTarget,
  readJskitHistoryNavigationEnvelope,
  reduceJskitNavigationTask,
  resolveJskitRouteNavigationMeta,
} from "../shared/navigation.js";
import {
  createSecureNavigationId as randomId,
  isRecord,
  normalizeOptionalText,
} from "../shared/navigationInternals.js";
import { createBrowserSessionNavigationStorage } from "./navigationStorage.js";
import { createNavigationInteractionCoordinator } from "./navigationInteraction.js";
import { createNavigationRestorationCoordinator } from "./navigationRestoration.js";
import {
  createNavigationAbortError as createAbortError,
  isNavigationAbortError as isAbortError,
} from "./navigationRuntimeInternals.js";
import { createJskitNavigationScrollCoordinator } from "./navigationScroll.js";

const JSKIT_NAVIGATION_RUNTIME_KEY = Symbol.for(
  "jskit.client.navigation.runtime.v1",
);
const installedRuntimeByRouter = new WeakMap();
function normalizeText(value) {
  return normalizeOptionalText(value) || "";
}

function currentTime() {
  return Date.now();
}

function ignoreRejectedPromise() {}

function optionalTextsMatch(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function normalizeRouteName(value) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "symbol"
  ) {
    const normalized = String(value).trim();
    return normalized || undefined;
  }
  return undefined;
}

function normalizeRouteParams(value) {
  if (!isRecord(value)) {
    return undefined;
  }
  const params = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null) {
      continue;
    }
    params[key] = Array.isArray(entry)
      ? entry.map(String).join("/")
      : String(entry);
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function normalizeRouteQuery(value, allowlist = []) {
  if (!isRecord(value)) {
    return {};
  }
  const allowed = new Set(Array.isArray(allowlist) ? allowlist : []);
  const query = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key) || entry == null) {
      continue;
    }
    if (Array.isArray(entry)) {
      query[key] = entry.filter((item) => item != null).map(String);
    } else {
      query[key] = String(entry);
    }
  }
  return query;
}

function firstNormalizedText(value, fields) {
  for (const field of fields) {
    const normalized = normalizeText(value?.[field]);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function resolveMatchedJskitMetaField(route, field) {
  let resolved;
  for (const record of Array.isArray(route?.matched) ? route.matched : []) {
    const jskit = isRecord(record?.meta?.jskit) ? record.meta.jskit : null;
    if (jskit && Object.hasOwn(jskit, field)) {
      resolved = jskit[field];
    }
  }
  if (resolved !== undefined) {
    return resolved;
  }
  const mergedJskit = isRecord(route?.meta?.jskit) ? route.meta.jskit : null;
  return mergedJskit?.[field];
}

function defaultScopeResolver({ route }) {
  const params = isRecord(route?.params) ? route.params : {};
  const surface = normalizeText(resolveMatchedJskitMetaField(route, "surface"));
  const workspace = firstNormalizedText(params, [
    "workspaceId",
    "workspaceSlug",
    "workspace",
  ]);
  const tenant = firstNormalizedText(params, [
    "tenantId",
    "tenantSlug",
    "tenant",
  ]);
  return {
    ...(surface ? { surface } : {}),
    ...(workspace ? { workspace } : {}),
    ...(tenant ? { tenant } : {}),
  };
}

function createRouteContext(route, scope, signal) {
  const name = normalizeRouteName(route?.name);
  return Object.freeze({
    route: Object.freeze({
      ...(name ? { name } : {}),
      fullPath: String(route?.fullPath || route?.path || "/"),
      path: String(route?.path || "/"),
      query: isRecord(route?.query) ? { ...route.query } : {},
      hash: String(route?.hash || ""),
    }),
    scope,
    signal,
  });
}

function normalizePersistence(meta) {
  return (
    meta?.persistence ||
    Object.freeze({ mode: "url-only", queryAllowlist: Object.freeze([]) })
  );
}

function createMinimalStoredRoute(route) {
  const path = normalizeJskitInternalFullPath(String(route?.path || "/"));
  return Object.freeze({
    fullPath: path,
    path,
    query: Object.freeze({}),
    hash: "",
  });
}

function normalizeSanitizedQuery(value) {
  if (!isRecord(value)) {
    return {};
  }
  const query = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null) {
      continue;
    }
    if (typeof entry === "string") {
      query[key] = entry;
      continue;
    }
    if (
      Array.isArray(entry) &&
      entry.every((item) => typeof item === "string")
    ) {
      query[key] = [...entry];
      continue;
    }
    throw new TypeError(
      `Navigation sanitizer query field "${key}" must contain strings.`,
    );
  }
  return query;
}

function createStoredRoute(
  route,
  meta,
  router,
  resolvers,
  scope,
  signal,
  development,
) {
  const persistence = normalizePersistence(meta);
  const context = createRouteContext(route, scope, signal);
  if (persistence.mode === "none") {
    return createMinimalStoredRoute(route);
  }

  if (persistence.sanitizer) {
    const sanitizer = resolvers.resolveSanitizer(persistence.sanitizer);
    if (!sanitizer) {
      if (development) {
        throw new Error(
          `Unknown JSKIT navigation sanitizer token "${persistence.sanitizer}".`,
        );
      }
      return createMinimalStoredRoute(route);
    }
    const sanitized = sanitizer(context);
    if (!sanitized) {
      return createMinimalStoredRoute(route);
    }
    const path = normalizeJskitInternalFullPath(String(sanitized.path || "/"));
    if (path.includes("?") || path.includes("#")) {
      throw new TypeError(
        "Navigation sanitizer path must not contain query or hash data.",
      );
    }
    const query = normalizeSanitizedQuery(sanitized.query);
    const hash = String(sanitized.hash || "");
    if (hash && !hash.startsWith("#")) {
      throw new TypeError(
        "Navigation sanitizer hash must be empty or start with '#'.",
      );
    }
    const resolved = router.resolve({
      path,
      query,
      hash,
    });
    const fullPath = normalizeJskitInternalFullPath(resolved.fullPath);
    return Object.freeze({
      fullPath,
      path,
      query: Object.freeze(query),
      hash,
    });
  }

  const path = normalizeJskitInternalFullPath(String(route?.path || "/"));
  const query = normalizeRouteQuery(route?.query, persistence.queryAllowlist);
  const hash = String(route?.hash || "");
  const resolved = router.resolve({ path, query, hash });
  const fullPath = normalizeJskitInternalFullPath(resolved.fullPath);
  return Object.freeze({ fullPath, path, query: Object.freeze(query), hash });
}

function createJskitNavigationContext({
  router,
  history,
  storage = null,
  scopeResolver = defaultScopeResolver,
  resolvers = createJskitNavigationResolverRegistry(),
  limits: limitOverrides = {},
  scrollCoordinator = createJskitNavigationScrollCoordinator(),
  logger = console,
  windowObject = typeof window === "undefined" ? null : window,
  documentObject = typeof document === "undefined" ? null : document,
  cryptoObject = globalThis.crypto,
  now = currentTime,
  development = typeof process === "undefined" ||
    process.env?.NODE_ENV !== "production",
} = {}) {
  const limits = createJskitNavigationLimits(limitOverrides);
  const stateSource = shallowReactive({
    ready: false,
    canPop: false,
    canGoUp: false,
    activeEntry: null,
    previousEntry: null,
    restoring: false,
    predictiveProgress: null,
  });
  const navigation = {
    router,
    history,
    scopeResolver,
    resolvers,
    limits,
    logger,
    windowObject,
    documentObject,
    cryptoObject,
    now,
    development,
    scrollCoordinator,
    repository:
      storage || createBrowserSessionNavigationStorage({ limits, logger }),
    _stateSource: stateSource,
    state: readonly(stateSource),
    cleanup: [],
    windowListeners: [],
    disposed: false,
    initialized: false,
    initializationPromise: null,
    initializationController: null,
    _taskId: "",
    sequence: 0,
    currentBrowserEntry: null,
    currentMeta: null,
    currentScope: Object.freeze({}),
    currentFallback: null,
    pendingExplicitOperation: null,
    pendingHistoryPop: false,
    pendingHistoryDirection: "",
    operationTail: Promise.resolve(),
    commitTail: Promise.resolve(),
    popInFlight: null,
    scopeOverrides: Object.freeze({}),
    interactions: null,
    restoration: null,
    blockerState: null,
  };

  navigation.interactions = createNavigationInteractionCoordinator({
    documentObject,
    diagnostic(level, reason, details) {
      diagnostic(navigation, level, reason, details);
    },
    ensureActive() {
      ensureActive(navigation);
    },
    onTransientStateChange() {
      refreshCanGoUp(navigation);
    },
  });
  navigation.blockerState = navigation.interactions.blockerState;
  navigation.restoration = createNavigationRestorationCoordinator({
    repository: navigation.repository,
    router,
    stateSource,
    limits,
    windowObject,
    documentObject,
    cryptoObject,
    now,
    diagnostic(level, reason, details) {
      diagnostic(navigation, level, reason, details);
    },
    ensureActive() {
      ensureActive(navigation);
    },
    getContext() {
      return getRestorationContext(navigation);
    },
    persistedRouteFor(route, meta, scope, signal) {
      return persistedRouteFor(navigation, route, meta, scope, signal);
    },
    stampCapturedDestination(destination) {
      return stampCapturedDestination(navigation, destination);
    },
  });

  return navigation;
}

function diagnostic(navigation, level, reason, details = {}) {
  if (typeof navigation.logger?.[level] !== "function") {
    return;
  }
  navigation.logger[level](
    {
      navigation: {
        reason,
        ...details,
      },
    },
    "JSKIT navigation diagnostic.",
  );
}

function ensureActive(navigation) {
  if (navigation.disposed) {
    throw new Error("JSKIT navigation runtime is disposed.");
  }
}

function routeMeta(route) {
  const meta = resolveJskitRouteNavigationMeta(route);
  if (!meta) {
    const routeIdentity =
      normalizeRouteName(route?.name) ||
      String(route?.path || route?.fullPath || "route");
    throw new Error(
      `Route "${routeIdentity}" requires explicit meta.jskit.navigation metadata when JSKIT navigation is enabled.`,
    );
  }
  return meta;
}

async function resolveScope(navigation, route, signal) {
  const value = await navigation.scopeResolver({ route, signal });
  if (signal.aborted) {
    throw createAbortError();
  }
  return normalizeJskitNavigationScope({
    ...(value || {}),
    ...navigation.scopeOverrides,
  });
}

function collectScopeFields(...scopes) {
  const fields = new Set();
  for (const scope of scopes) {
    for (const field of Object.keys(scope || {})) {
      if (JSKIT_NAVIGATION_SCOPE_FIELDS.includes(field)) {
        fields.add(field);
      }
    }
  }
  return [...fields];
}

function destinationScope(meta, scope) {
  const fields = meta?.scope || Object.keys(scope || {});
  const destination = {};
  for (const field of fields) {
    if (scope?.[field] !== undefined) {
      destination[field] = scope[field];
    }
  }
  return normalizeJskitNavigationScope(destination);
}

async function setScope(navigation, value = {}) {
  ensureActive(navigation);
  if (!isRecord(value)) {
    throw new TypeError("JSKIT navigation scope update must be an object.");
  }
  if (!navigation.initialized) {
    navigation.scopeOverrides = mergeScopeOverrides(
      navigation.scopeOverrides,
      value,
    );
    return Object.freeze({ status: "completed", reason: "scope-staged" });
  }

  navigation._stateSource.canPop = false;
  navigation._stateSource.canGoUp =
    navigation.interactions.hasOpenTransientLayer();
  navigation.restoration.abortRestore();
  return runSerialized(navigation, function serializeScopeUpdate() {
    return commitScopeUpdate(navigation, value);
  });
}

function commitScopeUpdate(navigation, value) {
  return runCommitSerialized(navigation, function commitScopeChange() {
    return applyScopeUpdate(navigation, value);
  });
}

async function applyScopeUpdate(navigation, value) {
  navigation.scopeOverrides = mergeScopeOverrides(
    navigation.scopeOverrides,
    value,
  );
  const controller = new AbortController();
  const route = navigation.router.currentRoute.value;
  const nextScope = await resolveScope(navigation, route, controller.signal);
  const fields = collectScopeFields(navigation.currentScope, nextScope);
  if (jskitNavigationScopesMatch(navigation.currentScope, nextScope, fields)) {
    refreshCanGoUp(navigation);
    return Object.freeze({ status: "completed", reason: "scope-unchanged" });
  }
  await startNewTask(navigation, nextScope);
  return commitRoute(navigation, route, { kind: "replace" });
}

function mergeScopeOverrides(current, update) {
  const merged = { ...current };
  for (const field of JSKIT_NAVIGATION_SCOPE_FIELDS) {
    if (!Object.hasOwn(update, field)) {
      continue;
    }
    const normalized = normalizeText(update[field]);
    if (normalized) {
      merged[field] = normalized;
    } else {
      delete merged[field];
    }
  }
  return Object.freeze(merged);
}

function resolveTarget(navigation, target) {
  const normalized = normalizeJskitNavigationTarget(target);
  let resolved;
  try {
    resolved = navigation.router.resolve(normalized);
  } catch (error) {
    throw new TypeError(
      `JSKIT navigation target could not be resolved: ${String(error?.message || error)}`,
    );
  }
  normalizeJskitInternalFullPath(resolved.fullPath);
  return Object.freeze({ normalized, resolved });
}

async function resolveFallback(navigation, meta, route, scope, signal) {
  if (!meta?.fallback) {
    return null;
  }
  let target = meta.fallback;
  if (typeof target === "string") {
    const resolver = navigation.resolvers.resolveFallback(target);
    if (!resolver) {
      if (navigation.development) {
        throw new Error(
          `Unknown JSKIT navigation fallback resolver token "${target}".`,
        );
      }
      diagnostic(navigation, "warn", "unknown-fallback-resolver", {
        token: target,
      });
      return null;
    }
    target = await resolver(createRouteContext(route, scope, signal));
  }
  if (!target || signal.aborted) {
    return null;
  }
  const resolved = resolveTarget(navigation, target);
  return resolved.normalized;
}

function createEnvelope(browserEntry, destinationEntry = null) {
  return Object.freeze({
    schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
    taskId: browserEntry.taskId,
    browserEntryId: browserEntry.browserEntryId,
    ...(browserEntry.destinationEntryId
      ? { destinationEntryId: browserEntry.destinationEntryId }
      : {}),
    ...(browserEntry.previousJskitBrowserEntryId
      ? {
          previousJskitBrowserEntryId: browserEntry.previousJskitBrowserEntryId,
        }
      : {}),
    sequence: browserEntry.sequence,
    kind: browserEntry.kind,
    ...(destinationEntry?.destinationKey
      ? { destinationKey: destinationEntry.destinationKey }
      : {}),
    ...(browserEntry.machineryKey
      ? { machineryKey: browserEntry.machineryKey }
      : {}),
    ...(destinationEntry?.snapshotRef
      ? { snapshotRef: destinationEntry.snapshotRef }
      : {}),
  });
}

function envelopeMatchesStoredEntry(
  envelope,
  browserEntry,
  destinationEntry = null,
) {
  if (!envelope || !browserEntry) {
    return false;
  }
  return Boolean(
    envelope.taskId === browserEntry.taskId &&
    envelope.browserEntryId === browserEntry.browserEntryId &&
    envelope.sequence === browserEntry.sequence &&
    envelope.kind === browserEntry.kind &&
    optionalTextsMatch(
      envelope.destinationEntryId,
      browserEntry.destinationEntryId,
    ) &&
    optionalTextsMatch(
      envelope.previousJskitBrowserEntryId,
      browserEntry.previousJskitBrowserEntryId,
    ) &&
    optionalTextsMatch(envelope.machineryKey, browserEntry.machineryKey) &&
    (!destinationEntry ||
      optionalTextsMatch(
        envelope.destinationKey,
        destinationEntry.destinationKey,
      )),
  );
}

function entryMatchesRouteMeta(browserEntry, destinationEntry, meta) {
  const expectedKind =
    meta.behavior === "preserve" ? "machinery" : meta.behavior;
  if (browserEntry?.kind !== expectedKind) {
    return false;
  }
  if (expectedKind === "destination") {
    return Boolean(
      destinationEntry &&
      destinationEntry.taskId === browserEntry.taskId &&
      browserEntry.destinationEntryId === destinationEntry.destinationEntryId &&
      destinationEntry.destinationKey === meta.destinationKey,
    );
  }
  if (expectedKind === "machinery") {
    return Boolean(
      browserEntry.machineryKey === meta.machineryKey &&
      (browserEntry.destinationEntryId
        ? destinationEntry?.taskId === browserEntry.taskId &&
          destinationEntry.destinationEntryId ===
            browserEntry.destinationEntryId
        : !destinationEntry),
    );
  }
  return !browserEntry.destinationEntryId && !destinationEntry;
}

function nativeHistoryStillRepresentsCurrentRoute(navigation) {
  try {
    return (
      normalizeJskitInternalFullPath(
        String(navigation.history.location || "/"),
      ) ===
      normalizeJskitInternalFullPath(
        String(navigation.router.currentRoute.value?.fullPath || "/"),
      )
    );
  } catch {
    return false;
  }
}

function stampCurrentHistory(
  navigation,
  browserEntry,
  destinationEntry = null,
) {
  try {
    const currentState = navigation.history.state ?? {};
    const nextState = mergeJskitHistoryNavigationEnvelope(
      currentState,
      createEnvelope(browserEntry, destinationEntry),
    );
    navigation.history.replace(navigation.history.location, nextState);
    return true;
  } catch (error) {
    diagnostic(navigation, "warn", "history-state-write-failed", {
      errorName: String(error?.name || "Error"),
    });
    return false;
  }
}

async function resolvePrevious(navigation, browserEntry, scope) {
  const previousId = normalizeText(browserEntry?.previousJskitBrowserEntryId);
  if (!previousId || !navigation._taskId) {
    return Object.freeze({ canPop: false, previousEntry: null });
  }
  const previousBrowserEntry = await navigation.repository.readBrowserEntry(
    navigation._taskId,
    previousId,
  );
  if (
    !previousBrowserEntry ||
    previousBrowserEntry.taskId !== navigation._taskId ||
    !normalizeText(previousBrowserEntry.fullPath)
  ) {
    return Object.freeze({ canPop: false, previousEntry: null });
  }
  try {
    normalizeJskitInternalFullPath(previousBrowserEntry.fullPath);
  } catch {
    return Object.freeze({ canPop: false, previousEntry: null });
  }
  let previousMeta;
  try {
    previousMeta = resolveJskitRouteNavigationMeta(
      navigation.router.resolve(previousBrowserEntry.fullPath),
    );
  } catch {
    previousMeta = null;
  }
  if (!previousMeta) {
    return Object.freeze({ canPop: false, previousEntry: null });
  }
  let previousEntry = null;
  if (previousBrowserEntry.destinationEntryId) {
    const candidate = await navigation.repository.readDestination(
      navigation._taskId,
      previousBrowserEntry.destinationEntryId,
    );
    if (candidate) {
      const scopeFields =
        previousMeta.scope || Object.keys(candidate.scope || {});
      if (
        jskitNavigationScopesMatch(candidate.scope || {}, scope, scopeFields)
      ) {
        previousEntry = candidate;
      }
    }
    if (!previousEntry) {
      return Object.freeze({ canPop: false, previousEntry: null });
    }
  }
  if (
    !entryMatchesRouteMeta(previousBrowserEntry, previousEntry, previousMeta)
  ) {
    return Object.freeze({ canPop: false, previousEntry: null });
  }
  return Object.freeze({ canPop: true, previousEntry });
}

function refreshCanGoUp(navigation) {
  navigation._stateSource.canGoUp = Boolean(
    navigation.interactions.hasOpenTransientLayer() ||
    navigation._stateSource.canPop ||
    navigation.currentFallback,
  );
}

async function setActiveEntry(
  navigation,
  browserEntry,
  destinationEntry,
  meta,
  scope,
  fallback,
) {
  navigation.currentBrowserEntry = browserEntry;
  navigation.currentMeta = meta;
  navigation.currentScope = scope;
  navigation.currentFallback = fallback;
  navigation._taskId = browserEntry.taskId;
  navigation.sequence = browserEntry.sequence;
  const previous = await resolvePrevious(navigation, browserEntry, scope);
  navigation._stateSource.activeEntry = destinationEntry || null;
  navigation._stateSource.previousEntry = previous.previousEntry;
  navigation._stateSource.canPop = previous.canPop;
  refreshCanGoUp(navigation);
}

function persistedRouteFor(navigation, route, meta, scope, signal) {
  return createStoredRoute(
    route,
    meta,
    navigation.router,
    navigation.resolvers,
    scope,
    signal,
    navigation.development,
  );
}

function getRestorationContext(navigation) {
  return Object.freeze({
    disposed: navigation.disposed,
    taskId: navigation._taskId,
    browserEntry: navigation.currentBrowserEntry,
    activeEntry: navigation._stateSource.activeEntry,
    meta: navigation.currentMeta,
    scope: navigation.currentScope,
  });
}

function stampCapturedDestination(navigation, destinationEntry) {
  if (
    navigation.currentBrowserEntry?.destinationEntryId !==
      destinationEntry.destinationEntryId ||
    !nativeHistoryStillRepresentsCurrentRoute(navigation)
  ) {
    return true;
  }
  return stampCurrentHistory(
    navigation,
    navigation.currentBrowserEntry,
    destinationEntry,
  );
}

function createDestinationEntry(
  navigation,
  {
    route,
    meta,
    scope,
    fallback,
    destinationEntryId = null,
    createdAt = null,
    snapshotRef = null,
    snapshotFullPath = null,
    signal,
  },
) {
  const timestamp = navigation.now();
  const storedRoute = persistedRouteFor(navigation, route, meta, scope, signal);
  const reusableSnapshotRef =
    snapshotFullPath === storedRoute.fullPath ? snapshotRef : null;
  const routeName = normalizeRouteName(route?.name);
  const params = normalizeRouteParams(route?.params);
  return Object.freeze({
    schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
    destinationEntryId:
      destinationEntryId || randomId("destination", navigation.cryptoObject),
    taskId: navigation._taskId,
    destinationKey: meta.destinationKey,
    fullPath: storedRoute.fullPath,
    ...(routeName ? { routeName } : {}),
    ...(params ? { params } : {}),
    scope: destinationScope(meta, scope),
    createdAt: createdAt ?? timestamp,
    updatedAt: timestamp,
    ...(reusableSnapshotRef ? { snapshotRef: reusableSnapshotRef } : {}),
    ...(fallback ? { fallback } : {}),
  });
}

function createBrowserEntry(
  navigation,
  {
    route,
    meta,
    scope,
    destinationEntryId = null,
    browserEntryId = null,
    previousId = null,
    nextSequence,
    createdAt = null,
    signal,
  },
) {
  const storedRoute = persistedRouteFor(navigation, route, meta, scope, signal);
  const kind = meta.behavior === "preserve" ? "machinery" : meta.behavior;
  const routeName = normalizeRouteName(route?.name);
  return Object.freeze({
    schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
    browserEntryId:
      browserEntryId || randomId("browser", navigation.cryptoObject),
    taskId: navigation._taskId,
    sequence: nextSequence,
    kind,
    ...(destinationEntryId ? { destinationEntryId } : {}),
    ...(previousId ? { previousJskitBrowserEntryId: previousId } : {}),
    fullPath: storedRoute.fullPath,
    ...(routeName ? { routeName } : {}),
    ...(meta.behavior === "preserve"
      ? { machineryKey: meta.machineryKey }
      : {}),
    createdAt: createdAt ?? navigation.now(),
  });
}

async function persistCommit(navigation, browserEntry, destinationEntry) {
  if (destinationEntry) {
    await navigation.repository.writeDestination(destinationEntry);
  }
  await navigation.repository.writeBrowserEntry(browserEntry);
  await navigation.repository.prune(navigation.now(), navigation.limits);
}

function resolveBrowserEntryPosition(
  navigation,
  { isReplace, kind, previousBrowserEntry },
) {
  if (!previousBrowserEntry) {
    return Object.freeze({
      browserEntryId: null,
      previousId: null,
      nextSequence: 0,
      createdAt: null,
    });
  }
  if (!isReplace) {
    return Object.freeze({
      browserEntryId: null,
      previousId: previousBrowserEntry.browserEntryId,
      nextSequence: navigation.sequence + 1,
      createdAt: null,
    });
  }
  return Object.freeze({
    browserEntryId: previousBrowserEntry.browserEntryId,
    previousId:
      kind === "synthetic-fallback"
        ? null
        : previousBrowserEntry.previousJskitBrowserEntryId || null,
    nextSequence: previousBrowserEntry.sequence,
    createdAt: previousBrowserEntry.createdAt,
  });
}

function scopeChanged(previousScope, nextScope) {
  const fields = collectScopeFields(previousScope, nextScope);
  return (
    fields.length > 0 &&
    !jskitNavigationScopesMatch(previousScope || {}, nextScope || {}, fields)
  );
}

async function startNewTask(navigation, nextScope) {
  const oldTaskId = navigation._taskId;
  if (oldTaskId) {
    await navigation.repository.deleteTask(oldTaskId);
  }
  navigation._taskId = randomId("task", navigation.cryptoObject);
  navigation.sequence = 0;
  navigation.currentBrowserEntry = null;
  navigation.currentMeta = null;
  navigation.currentFallback = null;
  navigation.currentScope = nextScope;
  navigation._stateSource.activeEntry = null;
  navigation._stateSource.previousEntry = null;
  navigation._stateSource.canPop = false;
}

function taskDestinationsMatchScope(task, scope) {
  for (const { entry } of Object.values(task?.destinations || {})) {
    const fields = Object.keys(entry?.scope || {});
    if (
      fields.length > 0 &&
      !jskitNavigationScopesMatch(entry.scope, scope, fields)
    ) {
      return false;
    }
  }
  return true;
}

async function performInitialization(navigation, controller) {
  if (typeof navigation.router.isReady === "function") {
    await navigation.router.isReady();
  }
  ensureActive(navigation);
  const route = navigation.router.currentRoute.value;
  const meta = routeMeta(route);
  const scope = await resolveScope(navigation, route, controller.signal);
  await navigation.repository.prune(navigation.now(), navigation.limits);
  const envelope = readJskitHistoryNavigationEnvelope(navigation.history.state);

  if (envelope) {
    const storedTask = await navigation.repository.readTask(envelope.taskId);
    const storedBrowser = await navigation.repository.readBrowserEntry(
      envelope.taskId,
      envelope.browserEntryId,
    );
    const storedDestination = envelope.destinationEntryId
      ? await navigation.repository.readDestination(
          envelope.taskId,
          envelope.destinationEntryId,
        )
      : null;
    const storedRoute = persistedRouteFor(
      navigation,
      route,
      meta,
      scope,
      controller.signal,
    );
    const scopeFields =
      meta.scope || Object.keys(storedDestination?.scope || {});
    const valid = Boolean(
      storedTask &&
      storedBrowser &&
      taskDestinationsMatchScope(storedTask, scope) &&
      envelopeMatchesStoredEntry(envelope, storedBrowser, storedDestination) &&
      entryMatchesRouteMeta(storedBrowser, storedDestination, meta) &&
      storedBrowser.fullPath === storedRoute.fullPath &&
      (!envelope.destinationEntryId ||
        (storedDestination &&
          storedDestination.destinationEntryId ===
            envelope.destinationEntryId &&
          jskitNavigationScopesMatch(
            storedDestination.scope || {},
            scope,
            scopeFields,
          ))),
    );
    if (valid) {
      navigation._taskId = envelope.taskId;
      const activeTask = reduceJskitNavigationTask(storedTask, {
        type: "activate",
        browserEntryId: envelope.browserEntryId,
        now: navigation.now(),
      });
      await navigation.repository.writeTask(activeTask);
      const fallback = await resolveFallback(
        navigation,
        meta,
        route,
        scope,
        controller.signal,
      );
      await setActiveEntry(
        navigation,
        storedBrowser,
        storedDestination,
        meta,
        scope,
        fallback,
      );
      navigation.initialized = true;
      navigation._stateSource.ready = true;
      if (storedDestination?.snapshotRef) {
        await navigation.restoration.queueRestore(
          storedDestination,
          "reload",
          route,
        );
      }
      return navigation;
    }
    await navigation.repository.deleteTask(envelope.taskId);
  }

  navigation._taskId = randomId("task", navigation.cryptoObject);
  navigation.currentScope = scope;
  const fallback = await resolveFallback(
    navigation,
    meta,
    route,
    scope,
    controller.signal,
  );
  let destinationEntry = null;
  if (meta.behavior === "destination") {
    destinationEntry = createDestinationEntry(navigation, {
      route,
      meta,
      scope,
      fallback,
      signal: controller.signal,
    });
  }
  const browserEntry = createBrowserEntry(navigation, {
    route,
    meta,
    scope,
    destinationEntryId: destinationEntry?.destinationEntryId || null,
    nextSequence: 0,
    signal: controller.signal,
  });
  await persistCommit(navigation, browserEntry, destinationEntry);
  stampCurrentHistory(navigation, browserEntry, destinationEntry);
  await setActiveEntry(
    navigation,
    browserEntry,
    destinationEntry,
    meta,
    scope,
    fallback,
  );
  navigation.initialized = true;
  navigation._stateSource.ready = true;
  return navigation;
}

async function initializeCurrentRoute(navigation) {
  ensureActive(navigation);
  if (navigation.initialized) {
    return navigation;
  }
  if (!navigation.initializationPromise) {
    const controller = new AbortController();
    navigation.initializationController = controller;
    navigation.initializationPromise = performInitialization(
      navigation,
      controller,
    );
  }
  const pending = navigation.initializationPromise;
  try {
    return await pending;
  } finally {
    if (navigation.initializationPromise === pending) {
      navigation.initializationController = null;
      navigation.initializationPromise = null;
    }
  }
}

async function rehydratePop(
  navigation,
  route,
  meta,
  scope,
  signal,
  restorationReason = "pop",
) {
  const envelope = readJskitHistoryNavigationEnvelope(navigation.history.state);
  if (!envelope || envelope.taskId !== navigation._taskId) {
    return null;
  }
  const browserEntry = await navigation.repository.readBrowserEntry(
    navigation._taskId,
    envelope.browserEntryId,
  );
  if (!browserEntry) {
    return null;
  }
  const storedRoute = persistedRouteFor(navigation, route, meta, scope, signal);
  if (browserEntry.fullPath !== storedRoute.fullPath) {
    return null;
  }
  let destinationEntry = null;
  if (browserEntry.destinationEntryId) {
    destinationEntry = await navigation.repository.readDestination(
      navigation._taskId,
      browserEntry.destinationEntryId,
    );
    const scopeFields =
      meta.scope || Object.keys(destinationEntry?.scope || {});
    if (
      !destinationEntry ||
      !jskitNavigationScopesMatch(
        destinationEntry.scope || {},
        scope,
        scopeFields,
      )
    ) {
      return null;
    }
  }
  if (!envelopeMatchesStoredEntry(envelope, browserEntry, destinationEntry)) {
    return null;
  }
  if (!entryMatchesRouteMeta(browserEntry, destinationEntry, meta)) {
    return null;
  }
  const task = await navigation.repository.readTask(navigation._taskId);
  if (
    !task?.browserEntries?.[browserEntry.browserEntryId] ||
    !taskDestinationsMatchScope(task, scope)
  ) {
    return null;
  }
  await navigation.repository.writeTask(
    reduceJskitNavigationTask(task, {
      type: "activate",
      browserEntryId: browserEntry.browserEntryId,
      now: navigation.now(),
    }),
  );
  const fallback = await resolveFallback(
    navigation,
    meta,
    route,
    scope,
    signal,
  );
  await setActiveEntry(
    navigation,
    browserEntry,
    destinationEntry,
    meta,
    scope,
    fallback,
  );
  if (destinationEntry?.snapshotRef) {
    await navigation.restoration.queueRestore(
      destinationEntry,
      restorationReason,
      route,
    );
  }
  return Object.freeze({
    status: "completed",
    browserEntryId: browserEntry.browserEntryId,
    ...(destinationEntry
      ? { destinationEntryId: destinationEntry.destinationEntryId }
      : {}),
  });
}

async function commitRoute(
  navigation,
  route,
  { kind, operation = null, restorationReason = "pop" } = {},
) {
  const transactionId =
    operation?.id || randomId("transaction", navigation.cryptoObject);
  const controller = new AbortController();
  const meta = routeMeta(route);
  const scope = await resolveScope(navigation, route, controller.signal);

  if (kind === "browser-pop") {
    const restored = await rehydratePop(
      navigation,
      route,
      meta,
      scope,
      controller.signal,
      restorationReason,
    );
    if (restored) {
      return restored;
    }
    await startNewTask(navigation, scope);
  } else if (scopeChanged(navigation.currentScope, scope)) {
    await startNewTask(navigation, scope);
  } else {
    navigation.currentScope = scope;
  }

  const isReplace = Boolean(
    kind === "replace" ||
    kind === "synthetic-fallback" ||
    operation?.options?.replaceCurrentBrowserEntry === true,
  );
  const previousBrowserEntry = navigation.currentBrowserEntry;
  const previousDestinationEntry = navigation._stateSource.activeEntry;
  const fallback = await resolveFallback(
    navigation,
    meta,
    route,
    scope,
    controller.signal,
  );
  let destinationEntry = null;
  if (meta.behavior === "destination") {
    const preserveIdentity = Boolean(
      isReplace &&
      kind !== "synthetic-fallback" &&
      operation?.options?.preserveDestinationIdentity !== false &&
      previousDestinationEntry?.destinationKey === meta.destinationKey,
    );
    destinationEntry = createDestinationEntry(navigation, {
      route,
      meta,
      scope,
      fallback,
      destinationEntryId: preserveIdentity
        ? previousDestinationEntry.destinationEntryId
        : null,
      createdAt: preserveIdentity ? previousDestinationEntry.createdAt : null,
      snapshotRef: preserveIdentity
        ? previousDestinationEntry.snapshotRef
        : null,
      snapshotFullPath: preserveIdentity
        ? previousDestinationEntry.fullPath
        : null,
      signal: controller.signal,
    });
  } else if (
    meta.behavior === "preserve" &&
    previousDestinationEntry &&
    kind !== "browser-pop"
  ) {
    destinationEntry = previousDestinationEntry;
  }

  const browserPosition = resolveBrowserEntryPosition(navigation, {
    isReplace,
    kind,
    previousBrowserEntry,
  });
  const browserEntry = createBrowserEntry(navigation, {
    route,
    meta,
    scope,
    destinationEntryId: destinationEntry?.destinationEntryId || null,
    ...browserPosition,
    signal: controller.signal,
  });
  await persistCommit(navigation, browserEntry, destinationEntry);
  const stamped = stampCurrentHistory(
    navigation,
    browserEntry,
    destinationEntry,
  );
  await setActiveEntry(
    navigation,
    browserEntry,
    destinationEntry,
    meta,
    scope,
    fallback,
  );
  if (!stamped) {
    navigation._stateSource.previousEntry = null;
    navigation._stateSource.canPop = false;
    refreshCanGoUp(navigation);
  }

  if (destinationEntry?.snapshotRef && kind === "browser-pop") {
    await navigation.restoration.queueRestore(destinationEntry, "pop", route);
  } else if (operation?.options?.focus !== "preserve") {
    await navigation.restoration.focusPageHeading();
  }
  return Object.freeze({
    status: stamped ? "completed" : "degraded",
    ...(!stamped ? { reason: "history-state-write-failed" } : {}),
    browserEntryId: browserEntry.browserEntryId,
    ...(destinationEntry
      ? { destinationEntryId: destinationEntry.destinationEntryId }
      : {}),
    transactionId,
  });
}

function finishExplicitOperation(operation, result) {
  if (!operation || operation.settled) {
    return;
  }
  operation.settled = true;
  operation.deferred.resolve(result);
}

function installRouterHooks(navigation) {
  navigation.cleanup.push(
    navigation.router.beforeEach(function beforeRoute(to, from) {
      return onBeforeRoute(navigation, to, from);
    }),
  );
  navigation.cleanup.push(
    navigation.router.afterEach(function afterRoute(to, from, failure) {
      return onAfterRoute(navigation, to, from, failure);
    }),
  );
  if (typeof navigation.router.onError === "function") {
    navigation.cleanup.push(
      navigation.router.onError(function handleRouterError(error) {
        onRouterError(navigation, error);
      }),
    );
  }
  if (typeof navigation.history.listen === "function") {
    navigation.cleanup.push(
      navigation.history.listen(
        function handleHistoryChange(to, from, information) {
          onHistoryChange(navigation, to, from, information);
        },
      ),
    );
  }
}

async function onBeforeRoute(navigation, to, from) {
  if (
    !navigation.initialized ||
    navigation.disposed ||
    to.fullPath === from.fullPath
  ) {
    return true;
  }
  navigation.restoration.abortRestore();
  const allowed = await navigation.interactions.requestBlockerDecision(
    to,
    from,
  );
  if (!allowed) {
    return false;
  }
  await navigation.restoration.capture();
  return true;
}

function onAfterRoute(navigation, to, _from, failure) {
  if (!navigation.initialized || navigation.disposed) {
    return;
  }
  const operation = navigation.pendingExplicitOperation;
  if (failure) {
    navigation.pendingExplicitOperation = null;
    navigation.pendingHistoryPop = false;
    navigation.pendingHistoryDirection = "";
    navigation.restoration.deferScroll("");
    finishExplicitOperation(
      operation,
      Object.freeze({
        status: "cancelled",
        reason: "router-navigation-cancelled",
      }),
    );
    return;
  }
  const kind = navigation.pendingHistoryPop
    ? "browser-pop"
    : operation?.kind || "push";
  const restorationReason =
    navigation.pendingHistoryDirection === "forward" ? "forward" : "pop";
  navigation.pendingHistoryPop = false;
  navigation.pendingHistoryDirection = "";
  navigation.pendingExplicitOperation = null;
  void commitAfterRoute(navigation, to, { kind, operation, restorationReason });
}

async function commitAfterRoute(navigation, route, details) {
  try {
    const result = await runCommitSerialized(
      navigation,
      function commitCompletedRoute() {
        return commitRoute(navigation, route, details);
      },
    );
    finishExplicitOperation(details.operation, result);
  } catch (error) {
    if (!isAbortError(error)) {
      diagnostic(navigation, "error", "navigation-commit-failed", {
        errorName: String(error?.name || "Error"),
      });
    }
    finishExplicitOperation(
      details.operation,
      Object.freeze({
        status: "degraded",
        reason: isAbortError(error) ? "aborted" : "commit-failed",
      }),
    );
  }
}

function onRouterError(navigation, error) {
  const operation = navigation.pendingExplicitOperation;
  navigation.pendingExplicitOperation = null;
  navigation.pendingHistoryPop = false;
  navigation.pendingHistoryDirection = "";
  navigation.restoration.deferScroll("");
  diagnostic(navigation, "error", "router-error", {
    errorName: String(error?.name || "Error"),
  });
  finishExplicitOperation(
    operation,
    Object.freeze({ status: "degraded", reason: "router-error" }),
  );
}

function onHistoryChange(navigation, to, _from, information) {
  navigation.pendingHistoryPop =
    information?.type === "pop" || information?.delta !== 0;
  navigation.pendingHistoryDirection = String(information?.direction || "")
    .trim()
    .toLowerCase();
  const envelope = readJskitHistoryNavigationEnvelope(navigation.history.state);
  if (envelope?.snapshotRef) {
    navigation.restoration.deferScroll(to);
  }
}

async function runSerialized(navigation, operation) {
  const result = navigation.operationTail.then(operation, operation);
  navigation.operationTail = result.catch(ignoreRejectedPromise);
  return result;
}

async function runCommitSerialized(navigation, operation) {
  const result = navigation.commitTail.then(operation, operation);
  navigation.commitTail = result.catch(ignoreRejectedPromise);
  return result;
}

async function navigate(navigation, kind, target, options = {}) {
  return runSerialized(navigation, function serializeNavigation() {
    return performNavigation(navigation, kind, target, options);
  });
}

async function performNavigation(navigation, kind, target, options) {
  ensureActive(navigation);
  await initializeCurrentRoute(navigation);
  const { normalized, resolved } = resolveTarget(navigation, target);
  if (
    resolved.fullPath === navigation.router.currentRoute.value.fullPath &&
    kind !== "replace"
  ) {
    return Object.freeze({
      status: "completed",
      reason: "same-location",
      browserEntryId: navigation.currentBrowserEntry?.browserEntryId,
      destinationEntryId:
        navigation._stateSource.activeEntry?.destinationEntryId,
    });
  }
  const deferred = createDeferred();
  const operation = {
    id: randomId("transaction", navigation.cryptoObject),
    kind,
    options: isRecord(options) ? { ...options } : {},
    deferred,
    settled: false,
  };
  navigation.pendingExplicitOperation = operation;
  let failure;
  try {
    failure = await (kind === "replace" || kind === "synthetic-fallback"
      ? navigation.router.replace(normalized)
      : options.replaceCurrentBrowserEntry
        ? navigation.router.replace(normalized)
        : navigation.router.push(normalized));
  } catch (error) {
    if (navigation.pendingExplicitOperation === operation) {
      navigation.pendingExplicitOperation = null;
    }
    finishExplicitOperation(
      operation,
      Object.freeze({ status: "degraded", reason: "router-error" }),
    );
    diagnostic(navigation, "error", "router-operation-failed", {
      errorName: String(error?.name || "Error"),
    });
  }
  if (failure && !operation.settled) {
    finishExplicitOperation(
      operation,
      Object.freeze({
        status: "cancelled",
        reason: "router-navigation-cancelled",
      }),
    );
  }
  return deferred.promise;
}

async function goBackOne(navigation, reason, { skipTransient = false } = {}) {
  if (navigation.popInFlight) {
    return navigation.popInFlight;
  }
  navigation.popInFlight = runSerialized(
    navigation,
    function serializeBackNavigation() {
      return performBackNavigation(navigation, reason, skipTransient);
    },
  );
  try {
    return await navigation.popInFlight;
  } finally {
    navigation.popInFlight = null;
  }
}

async function performBackNavigation(navigation, reason, skipTransient) {
  ensureActive(navigation);
  await initializeCurrentRoute(navigation);
  if (!skipTransient) {
    const transientResult =
      await navigation.interactions.closeTopTransientLayer(
        reason === "shell-back" ? "up" : "back",
      );
    if (transientResult) {
      return transientResult;
    }
  }
  if (!navigation._stateSource.canPop) {
    return Object.freeze({
      status: "blocked",
      reason: "no-in-app-previous-destination",
    });
  }
  const deferred = createDeferred();
  const operation = {
    id: randomId("transaction", navigation.cryptoObject),
    kind: "pop",
    options: { reason },
    deferred,
    settled: false,
  };
  navigation.pendingExplicitOperation = operation;
  navigation.router.go(-1);
  return deferred.promise;
}

async function goUp(navigation, options = {}) {
  ensureActive(navigation);
  await initializeCurrentRoute(navigation);
  const reason = options?.reason || "shell-back";
  const transientResult =
    await navigation.interactions.closeTopTransientLayer("up");
  if (transientResult) {
    return transientResult;
  }
  if (navigation._stateSource.canPop) {
    return goBackOne(navigation, reason, { skipTransient: true });
  }
  if (navigation.currentFallback) {
    return navigate(
      navigation,
      "synthetic-fallback",
      navigation.currentFallback,
      {
        reason,
        preserveDestinationIdentity: false,
        focus: "heading",
      },
    );
  }
  return Object.freeze({
    status: "blocked",
    reason: "no-in-app-previous-destination",
  });
}

function setPredictiveProgress(navigation, progress) {
  if (progress == null) {
    navigation._stateSource.predictiveProgress = null;
    return;
  }
  const numeric = Number(progress);
  navigation._stateSource.predictiveProgress = Number.isFinite(numeric)
    ? Math.min(1, Math.max(0, numeric))
    : null;
}

async function reconcilePageShow(navigation, event) {
  if (!event?.persisted || navigation.disposed || !navigation.initialized) {
    return;
  }
  const route = navigation.router.currentRoute.value;
  const meta = routeMeta(route);
  const controller = new AbortController();
  const scope = await resolveScope(navigation, route, controller.signal);
  if (
    navigation.disposed ||
    route.fullPath !== navigation.router.currentRoute.value?.fullPath
  ) {
    return;
  }
  await rehydratePop(
    navigation,
    route,
    meta,
    scope,
    controller.signal,
    "bfcache",
  );
}

function dispose(navigation) {
  if (navigation.disposed) {
    return;
  }
  navigation.disposed = true;
  navigation.initializationController?.abort();
  navigation.restoration.dispose();
  const operation = navigation.pendingExplicitOperation;
  navigation.pendingExplicitOperation = null;
  navigation.pendingHistoryPop = false;
  navigation.pendingHistoryDirection = "";
  finishExplicitOperation(
    operation,
    Object.freeze({ status: "cancelled", reason: "disposed" }),
  );
  navigation.interactions.dispose();
  for (const { type, handler } of navigation.windowListeners.splice(0)) {
    navigation.windowObject?.removeEventListener?.(type, handler);
  }
  for (const remove of navigation.cleanup.splice(0)) {
    try {
      remove?.();
    } catch {
      // Teardown must remain safe in browser and test environments.
    }
  }
  navigation.scrollCoordinator.dispose?.();
  installedRuntimeByRouter.delete(navigation.router);
}

function initialize(navigation) {
  return initializeCurrentRoute(navigation);
}

function push(navigation, target, options) {
  return navigate(navigation, "push", target, options);
}

function preserve(navigation, target, options) {
  return navigate(navigation, "preserve", target, options);
}

function replace(navigation, target, options) {
  return navigate(navigation, "replace", target, options);
}

function pop(navigation, options = {}) {
  return goBackOne(navigation, options.reason || "programmatic");
}

function capture(navigation, destinationEntryId) {
  return navigation.restoration.capture(destinationEntryId);
}

function notifyAppMounted(navigation) {
  return navigation.restoration.notifyAppMounted();
}

function peekContributorSnapshot(navigation, contributorId) {
  return navigation.restoration.peekContributorSnapshot(contributorId);
}

function registerContributor(navigation, contributor) {
  return navigation.restoration.registerContributor(contributor);
}

function registerTransientLayer(navigation, layer) {
  return navigation.interactions.registerTransientLayer(layer);
}

function registerBlocker(navigation, blocker) {
  return navigation.interactions.registerBlocker(blocker);
}

function confirmBlockedNavigation(navigation) {
  return navigation.interactions.settleBlocker(true);
}

function cancelBlockedNavigation(navigation) {
  return navigation.interactions.settleBlocker(false);
}

function restoreBlockedNavigationFocus(navigation) {
  return navigation.interactions.restoreBlockedNavigationFocus();
}

function shouldDeferScroll(navigation, route) {
  return navigation.restoration.shouldDeferScroll(route);
}

function installWindowListeners(navigation) {
  if (!navigation.windowObject?.addEventListener) {
    return;
  }
  addWindowListener(navigation, "pagehide", function handlePageHide() {
    return onPageHide(navigation);
  });
  addWindowListener(navigation, "pageshow", function handlePageShow(event) {
    return onPageShow(navigation, event);
  });
  addWindowListener(
    navigation,
    "pointerdown",
    function handlePointerDown(event) {
      onPointerDown(navigation, event);
    },
    { passive: true },
  );
  addWindowListener(
    navigation,
    "keydown",
    function handleKeyDown() {
      onKeyDown(navigation);
    },
    { passive: true },
  );
}

function addWindowListener(navigation, type, handler, options = undefined) {
  navigation.windowObject.addEventListener(type, handler, options);
  navigation.windowListeners.push({ type, handler });
}

async function onPageHide(navigation) {
  try {
    await navigation.restoration.capture();
  } catch (error) {
    if (!navigation.disposed) {
      diagnostic(navigation, "warn", "pagehide-capture-failed", {
        errorName: String(error?.name || "Error"),
      });
    }
  }
}

async function onPageShow(navigation, event) {
  try {
    await runCommitSerialized(navigation, function reconcileRestoredPage() {
      return reconcilePageShow(navigation, event);
    });
  } catch (error) {
    if (!navigation.disposed && !isAbortError(error)) {
      diagnostic(navigation, "warn", "pageshow-reconcile-failed", {
        errorName: String(error?.name || "Error"),
      });
    }
  }
}

function onPointerDown(navigation, event) {
  navigation.restoration.setInputModality(
    event?.pointerType === "touch" ? "touch" : "pointer",
  );
}

function onKeyDown(navigation) {
  navigation.restoration.setInputModality("keyboard");
}

function createJskitNavigationRuntime(options = {}) {
  const navigation = createJskitNavigationContext(options);
  const runtime = Object.freeze({
    state: navigation.state,
    blockerState: navigation.blockerState,
    get taskId() {
      return navigation._taskId;
    },
    async initialize() {
      await initialize(navigation);
      return runtime;
    },
    push(target, operationOptions) {
      return push(navigation, target, operationOptions);
    },
    preserve(target, operationOptions) {
      return preserve(navigation, target, operationOptions);
    },
    replace(target, operationOptions) {
      return replace(navigation, target, operationOptions);
    },
    pop(operationOptions) {
      return pop(navigation, operationOptions);
    },
    goUp(operationOptions) {
      return goUp(navigation, operationOptions);
    },
    capture(destinationEntryId) {
      return capture(navigation, destinationEntryId);
    },
    notifyAppMounted() {
      return notifyAppMounted(navigation);
    },
    peekContributorSnapshot(contributorId) {
      return peekContributorSnapshot(navigation, contributorId);
    },
    registerContributor(contributor) {
      return registerContributor(navigation, contributor);
    },
    registerTransientLayer(layer) {
      return registerTransientLayer(navigation, layer);
    },
    registerBlocker(blocker) {
      return registerBlocker(navigation, blocker);
    },
    confirmBlockedNavigation() {
      return confirmBlockedNavigation(navigation);
    },
    cancelBlockedNavigation() {
      return cancelBlockedNavigation(navigation);
    },
    restoreBlockedNavigationFocus() {
      return restoreBlockedNavigationFocus(navigation);
    },
    shouldDeferScroll(route) {
      return shouldDeferScroll(navigation, route);
    },
    setPredictiveProgress(progress) {
      return setPredictiveProgress(navigation, progress);
    },
    setScope(scope) {
      return setScope(navigation, scope);
    },
    dispose() {
      return dispose(navigation);
    },
  });

  installRouterHooks(navigation);
  installWindowListeners(navigation);
  navigation.scrollCoordinator.attach(runtime);
  return runtime;
}

function installJskitNavigation(options = {}) {
  const { router, history, scopeResolver = defaultScopeResolver } = options;
  if (
    !router ||
    typeof router.beforeEach !== "function" ||
    typeof router.afterEach !== "function"
  ) {
    throw new TypeError(
      "installJskitNavigation requires a supported Vue Router instance.",
    );
  }
  if (
    !history ||
    typeof history.replace !== "function" ||
    typeof history.go !== "function"
  ) {
    throw new TypeError(
      "installJskitNavigation requires the exact RouterHistory supplied to Vue Router.",
    );
  }
  if (typeof scopeResolver !== "function") {
    throw new TypeError(
      "installJskitNavigation scopeResolver must be a function.",
    );
  }
  const existing = installedRuntimeByRouter.get(router);
  if (existing) {
    if (existing.history !== history) {
      throw new Error(
        "JSKIT navigation is already installed for this router with another RouterHistory.",
      );
    }
    return existing.runtime;
  }
  const runtime = createJskitNavigationRuntime({
    ...options,
    router,
    history,
    scopeResolver,
  });
  installedRuntimeByRouter.set(router, { history, runtime });
  return runtime;
}

function useJskitNavigation() {
  const navigation = inject(JSKIT_NAVIGATION_RUNTIME_KEY, null);
  if (!navigation) {
    throw new Error(
      "JSKIT navigation runtime is not provided. Enable navigation in createShellRouter/bootstrapClientShellApp.",
    );
  }
  return Object.freeze({
    canPop: computed(() => navigation.state.canPop),
    canGoUp: computed(() => navigation.state.canGoUp),
    activeEntry: computed(() => navigation.state.activeEntry),
    previousEntry: computed(() => navigation.state.previousEntry),
    restoring: computed(() => navigation.state.restoring),
    predictiveProgress: computed(() => navigation.state.predictiveProgress),
    push: navigation.push,
    preserve: navigation.preserve,
    replace: navigation.replace,
    pop: navigation.pop,
    goUp: navigation.goUp,
    capture: navigation.capture,
    peekContributorSnapshot: navigation.peekContributorSnapshot,
    registerContributor: navigation.registerContributor,
    registerTransientLayer: navigation.registerTransientLayer,
  });
}

function useJskitNavigationBlocker({
  id,
  isBlocked,
  title = "Discard changes?",
  message = "Your unsaved changes will be lost.",
} = {}) {
  const navigation = inject(JSKIT_NAVIGATION_RUNTIME_KEY, null);
  if (!navigation) {
    throw new Error(
      "useJskitNavigationBlocker() requires JSKIT navigation installation.",
    );
  }
  const unregister = navigation.registerBlocker({
    id,
    isBlocked,
    title,
    message,
  });
  onScopeDispose(unregister);
  return Object.freeze({
    pending: computed(
      () =>
        navigation.blockerState.pending &&
        navigation.blockerState.blockerId === id,
    ),
    unregister,
  });
}

export {
  JSKIT_NAVIGATION_RUNTIME_KEY,
  createBrowserSessionNavigationStorage,
  createJskitNavigationScrollCoordinator,
  installJskitNavigation,
  useJskitNavigation,
  useJskitNavigationBlocker,
};
