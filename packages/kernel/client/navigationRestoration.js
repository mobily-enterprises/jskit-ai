import { nextTick, readonly } from "vue";
import {
  JSKIT_NAVIGATION_SCHEMA_VERSION,
  normalizeJskitSerializableValue,
} from "../shared/navigation.js";
import {
  createSecureNavigationId,
  isRecord,
  normalizeOptionalText,
} from "../shared/navigationInternals.js";
import {
  createNavigationAbortError,
  createNavigationRestoreContext,
  isNavigationAbortError,
  normalizeNavigationScrollCoordinate,
  settleNavigationWithin,
  waitForNavigationReadiness,
} from "./navigationRuntimeInternals.js";

const CONTRIBUTOR_HOOKS = Object.freeze([
  "restoreBeforeData",
  "isDataReady",
  "restoreStructure",
  "resolveScrollTarget",
  "resolveFocusTarget",
  "migrate",
  "sanitize",
]);

function normalizeText(value) {
  return normalizeOptionalText(value) || "";
}

function navigationPersistence(meta) {
  return (
    meta?.persistence ||
    Object.freeze({ mode: "url-only", queryAllowlist: Object.freeze([]) })
  );
}

function isDegradedRestoreResult(value) {
  return value?.status === "degraded";
}

function createNavigationRestorationContext({
  repository,
  router,
  stateSource,
  limits,
  windowObject,
  documentObject,
  cryptoObject,
  now,
  diagnostic,
  ensureActive,
  getContext,
  persistedRouteFor,
  stampCapturedDestination,
}) {
  return {
    repository,
    router,
    stateSource,
    limits,
    windowObject,
    documentObject,
    cryptoObject,
    now,
    diagnostic,
    ensureActive,
    getContext,
    persistedRouteFor,
    stampCapturedDestination,
    contributors: new Map(),
    contributorListeners: new Set(),
    captureTail: Promise.resolve(),
    activeCaptureController: null,
    restoreController: null,
    queuedRestore: null,
    activeRestoreSnapshot: null,
    deferredScrollFullPath: "",
    lastInputModality: "programmatic",
    appMounted: false,
  };
}

function captureFocus(restoration) {
  const active = restoration.documentObject?.activeElement;
  if (!active || typeof active.getAttribute !== "function") {
    return undefined;
  }
  const focusKey = normalizeText(active.getAttribute("data-jskit-focus-key"));
  const contributorId = normalizeText(
    active.getAttribute("data-jskit-navigation-contributor"),
  );
  if (!focusKey && !contributorId) {
    return undefined;
  }
  return Object.freeze({
    ...(contributorId ? { contributorId } : {}),
    ...(focusKey ? { focusKey } : {}),
  });
}

function captureIds(restoration, meta) {
  return meta?.restore?.length
    ? [...meta.restore]
    : [...restoration.contributors.keys()].sort((left, right) =>
        left.localeCompare(right),
      );
}

async function captureContributorValues(restoration, ids, controller) {
  const values = {};
  let degraded = false;
  let reason = "";
  const deadline = Date.now() + restoration.limits.dataReadyTimeoutMs;

  for (const id of ids) {
    const contributor = restoration.contributors.get(id);
    if (!contributor) {
      degraded = true;
      reason ||= "missing-contributor";
      continue;
    }
    try {
      const captured = await settleNavigationWithin(
        Promise.resolve().then(() => contributor.capture()),
        {
          signal: controller.signal,
          timeoutMs: Math.max(1, deadline - Date.now()),
        },
      );
      if (!captured.completed) {
        restoration.diagnostic("warn", "contributor-capture-timeout", {
          contributorId: id,
        });
        return Object.freeze({
          values,
          degraded: true,
          reason: reason || "contributor-capture-timeout",
        });
      }
      let value = captured.value;
      if (value !== undefined && typeof contributor.sanitize === "function") {
        value = contributor.sanitize(value);
      }
      if (value !== undefined) {
        values[id] = {
          version: contributor.version,
          value: normalizeJskitSerializableValue(value, {
            limits: restoration.limits,
          }),
        };
      }
    } catch (error) {
      if (isNavigationAbortError(error)) {
        throw error;
      }
      degraded = true;
      reason ||= "partial-contributor-capture";
      restoration.diagnostic("warn", "contributor-capture-failed", {
        contributorId: id,
        errorName: String(error?.name || "Error"),
      });
    }
  }
  return Object.freeze({ values, degraded, reason });
}

async function persistCapture(
  restoration,
  destination,
  snapshot,
  captureStatus,
) {
  const context = restoration.getContext();
  if (
    context.activeEntry?.destinationEntryId !== destination.destinationEntryId
  ) {
    return Object.freeze({
      status: "skipped",
      reason: "destination-superseded",
    });
  }
  try {
    const snapshotRef = await restoration.repository.writeSnapshot(
      context.taskId,
      snapshot,
    );
    const updatedDestination = Object.freeze({
      ...destination,
      updatedAt: restoration.now(),
      snapshotRef,
    });
    await restoration.repository.writeDestination(updatedDestination);
    restoration.stateSource.activeEntry = updatedDestination;
    const stamped = restoration.stampCapturedDestination(updatedDestination);
    const storageDegraded = !restoration.repository.available;
    const degraded = captureStatus.degraded || storageDegraded || !stamped;
    const reason =
      captureStatus.reason ||
      (storageDegraded ? "storage-unavailable" : "history-state-write-failed");
    return Object.freeze({
      status: degraded ? "degraded" : "captured",
      destinationEntryId: destination.destinationEntryId,
      snapshotRef,
      ...(degraded ? { reason } : {}),
    });
  } catch (error) {
    restoration.diagnostic("warn", "snapshot-persistence-failed", {
      errorName: String(error?.name || "Error"),
    });
    return Object.freeze({
      status: "degraded",
      destinationEntryId: destination.destinationEntryId,
      reason: "snapshot-persistence-failed",
    });
  }
}

async function performCapture(restoration, destinationEntryId, controller) {
  restoration.ensureActive();
  const context = restoration.getContext();
  const destination = context.activeEntry;
  if (
    !destination ||
    (destinationEntryId &&
      destination.destinationEntryId !== destinationEntryId)
  ) {
    return Object.freeze({
      status: "skipped",
      reason: "no-active-destination",
    });
  }
  const persistence = navigationPersistence(context.meta);
  if (persistence.mode !== "snapshot") {
    return Object.freeze({
      status: "skipped",
      destinationEntryId: destination.destinationEntryId,
      reason: `persistence-${persistence.mode}`,
    });
  }

  try {
    const route = restoration.router.currentRoute.value;
    const captureStatus = await captureContributorValues(
      restoration,
      captureIds(restoration, context.meta),
      controller,
    );
    if (controller.signal.aborted) {
      throw createNavigationAbortError();
    }
    const storedRoute = restoration.persistedRouteFor(
      route,
      context.meta,
      context.scope,
      controller.signal,
    );
    const focus = captureFocus(restoration);
    const snapshot = {
      schema: JSKIT_NAVIGATION_SCHEMA_VERSION,
      destinationEntryId: destination.destinationEntryId,
      route: storedRoute,
      scroll: {
        x: normalizeNavigationScrollCoordinate(
          restoration.windowObject?.scrollX,
        ),
        y: normalizeNavigationScrollCoordinate(
          restoration.windowObject?.scrollY,
        ),
      },
      ...(focus ? { focus } : {}),
      contributors: captureStatus.values,
      capturedAt: restoration.now(),
    };
    return persistCapture(restoration, destination, snapshot, captureStatus);
  } catch (error) {
    if (isNavigationAbortError(error)) {
      return Object.freeze({ status: "skipped", reason: "aborted" });
    }
    restoration.diagnostic("warn", "snapshot-capture-failed", {
      errorName: String(error?.name || "Error"),
    });
    return Object.freeze({
      status: "degraded",
      destinationEntryId: destination.destinationEntryId,
      reason: "snapshot-capture-failed",
    });
  }
}

async function capture(restoration, destinationEntryId = null) {
  const runCapture = async () => {
    const controller = new AbortController();
    restoration.activeCaptureController = controller;
    try {
      return await performCapture(restoration, destinationEntryId, controller);
    } finally {
      if (restoration.activeCaptureController === controller) {
        restoration.activeCaptureController = null;
      }
    }
  };
  const result = restoration.captureTail.catch(() => {}).then(runCapture);
  restoration.captureTail = result.catch(() => {});
  return result;
}

function notifyContributorListeners(restoration) {
  for (const listener of restoration.contributorListeners) {
    listener();
  }
}

async function waitForContributors(restoration, ids, signal) {
  const expected = [...new Set(ids)].filter(Boolean);
  if (expected.every((id) => restoration.contributors.has(id))) {
    return true;
  }
  if (signal.aborted) {
    throw createNavigationAbortError();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    const finish = (value, error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      restoration.contributorListeners.delete(onChange);
      signal.removeEventListener("abort", onAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onChange = () => {
      if (expected.every((id) => restoration.contributors.has(id))) {
        finish(true);
      }
    };
    const onAbort = () => finish(false, createNavigationAbortError());
    restoration.contributorListeners.add(onChange);
    signal.addEventListener("abort", onAbort, { once: true });
    timeoutId = setTimeout(
      () => finish(false),
      restoration.limits.contributorRegistrationTimeoutMs,
    );
    onChange();
  });
}

function resolveContributorValue(restoration, contributor, stored) {
  if (!stored || !Number.isInteger(stored.version)) {
    return undefined;
  }
  let value = stored.value;
  if (stored.version !== contributor.version) {
    if (typeof contributor.migrate !== "function") {
      return undefined;
    }
    value = contributor.migrate(value, stored.version);
  }
  if (value !== undefined && typeof contributor.sanitize === "function") {
    value = contributor.sanitize(value);
  }
  return value === undefined
    ? undefined
    : normalizeJskitSerializableValue(value, { limits: restoration.limits });
}

async function focusPageHeading(restoration) {
  if (!restoration.appMounted || !restoration.documentObject) {
    return false;
  }
  await nextTick();
  const target = restoration.documentObject.querySelector?.(
    "[data-jskit-page-heading], main h1, main",
  );
  if (!target || typeof target.focus !== "function") {
    return false;
  }
  if (!target.hasAttribute?.("tabindex")) {
    target.setAttribute?.("tabindex", "-1");
  }
  target.focus({ preventScroll: true });
  return true;
}

function requestIsCurrent(restoration, request) {
  const context = restoration.getContext();
  return Boolean(
    !context.disposed &&
    request.taskId === context.taskId &&
    request.browserEntryId === context.browserEntry?.browserEntryId &&
    request.destination.destinationEntryId ===
      context.activeEntry?.destinationEntryId &&
    request.route.fullPath === restoration.router.currentRoute.value?.fullPath,
  );
}

function snapshotMatchesDestination(snapshot, destination) {
  return Boolean(
    snapshot?.schema === JSKIT_NAVIGATION_SCHEMA_VERSION &&
    snapshot.destinationEntryId === destination.destinationEntryId &&
    snapshot.route?.fullPath === destination.fullPath &&
    isRecord(snapshot.contributors),
  );
}

function throwIfAborted(signal) {
  if (signal.aborted) {
    throw createNavigationAbortError();
  }
}

async function prepareContributors(restoration, expected, snapshot, context) {
  const records = [];
  let degraded = false;
  for (const id of expected) {
    throwIfAborted(context.signal);
    const contributor = restoration.contributors.get(id);
    if (!contributor) {
      degraded = true;
      continue;
    }
    try {
      const value = resolveContributorValue(
        restoration,
        contributor,
        snapshot.contributors[id],
      );
      if (value === undefined) {
        degraded = true;
        continue;
      }
      const result = await contributor.restoreBeforeData?.(value, context);
      degraded ||= isDegradedRestoreResult(result);
      records.push(Object.freeze({ id, contributor, value }));
    } catch (error) {
      if (isNavigationAbortError(error)) {
        throw error;
      }
      degraded = true;
      restoration.diagnostic("warn", "contributor-pre-data-restore-failed", {
        contributorId: id,
        errorName: String(error?.name || "Error"),
      });
    }
  }
  return Object.freeze({ records: Object.freeze(records), degraded });
}

async function restoreStructures(restoration, records, context) {
  const readiness = await Promise.all(
    records.map(async (record) => {
      try {
        const ready = await waitForNavigationReadiness(
          () => record.contributor.isDataReady?.(context) ?? true,
          {
            signal: context.signal,
            timeoutMs: restoration.limits.dataReadyTimeoutMs,
          },
        );
        if (!ready) {
          restoration.diagnostic("warn", "contributor-data-timeout", {
            contributorId: record.id,
          });
        }
        return Object.freeze({ record, ready, failed: !ready });
      } catch (error) {
        if (isNavigationAbortError(error)) {
          throw error;
        }
        restoration.diagnostic("warn", "contributor-data-readiness-failed", {
          contributorId: record.id,
          errorName: String(error?.name || "Error"),
        });
        return Object.freeze({ record, ready: false, failed: true });
      }
    }),
  );

  const restored = [];
  let degraded = readiness.some((entry) => entry.failed);
  for (const { record, ready } of readiness) {
    throwIfAborted(context.signal);
    if (!ready) {
      continue;
    }
    try {
      const result = await record.contributor.restoreStructure?.(
        record.value,
        context,
      );
      degraded ||= isDegradedRestoreResult(result);
      restored.push(record);
    } catch (error) {
      if (isNavigationAbortError(error)) {
        throw error;
      }
      degraded = true;
      restoration.diagnostic("warn", "contributor-structure-restore-failed", {
        contributorId: record.id,
        errorName: String(error?.name || "Error"),
      });
    }
  }
  return Object.freeze({ records: Object.freeze(restored), degraded });
}

async function restoreScroll(restoration, records, snapshot, context) {
  let degraded = false;
  for (const { id, contributor, value } of records) {
    if (typeof contributor.resolveScrollTarget !== "function") {
      continue;
    }
    try {
      throwIfAborted(context.signal);
      const target = await contributor.resolveScrollTarget(value, context);
      if (!target || typeof target.scroll !== "function") {
        continue;
      }
      await target.scroll(
        {
          ...(target.itemKey ? { itemKey: target.itemKey } : {}),
          ...(Number.isFinite(target.offsetX)
            ? { offsetX: target.offsetX }
            : {}),
          ...(Number.isFinite(target.offsetY)
            ? { offsetY: target.offsetY }
            : {}),
        },
        context,
      );
      return Object.freeze({ degraded, restored: true });
    } catch (error) {
      if (isNavigationAbortError(error)) {
        throw error;
      }
      degraded = true;
      restoration.diagnostic("warn", "contributor-scroll-restore-failed", {
        contributorId: id,
        errorName: String(error?.name || "Error"),
      });
    }
  }
  return restoreRawScroll(restoration, snapshot, degraded);
}

function restoreRawScroll(restoration, snapshot, degraded) {
  if (
    !snapshot.scroll ||
    typeof restoration.windowObject?.scrollTo !== "function"
  ) {
    return Object.freeze({ degraded, restored: false });
  }
  try {
    restoration.windowObject.scrollTo(
      normalizeNavigationScrollCoordinate(snapshot.scroll.x),
      normalizeNavigationScrollCoordinate(snapshot.scroll.y),
    );
    return Object.freeze({ degraded, restored: true });
  } catch (error) {
    restoration.diagnostic("warn", "raw-scroll-restore-failed", {
      errorName: String(error?.name || "Error"),
    });
    return Object.freeze({ degraded: true, restored: false });
  }
}

async function restoreFocus(restoration, records, context) {
  if (restoration.lastInputModality === "touch") {
    return Object.freeze({ degraded: false, restored: false });
  }
  const deadline = Date.now() + restoration.limits.focusTimeoutMs;
  let degraded = false;
  for (const { id, contributor, value } of records) {
    if (typeof contributor.resolveFocusTarget !== "function") {
      continue;
    }
    try {
      const result = await restoreContributorFocus(
        restoration,
        id,
        contributor,
        value,
        context,
        deadline,
      );
      if (result.timedOut) {
        return Object.freeze({ degraded: true, restored: false });
      }
      if (result.restored) {
        return Object.freeze({ degraded, restored: true });
      }
      degraded ||= result.attempted;
    } catch (error) {
      if (isNavigationAbortError(error)) {
        throw error;
      }
      degraded = true;
      restoration.diagnostic("warn", "contributor-focus-restore-failed", {
        contributorId: id,
        errorName: String(error?.name || "Error"),
      });
    }
  }
  if (restoration.lastInputModality === "keyboard") {
    const restored = await focusPageHeading(restoration);
    return Object.freeze({ degraded: degraded || !restored, restored });
  }
  return Object.freeze({ degraded, restored: false });
}

async function restoreContributorFocus(
  restoration,
  id,
  contributor,
  value,
  context,
  deadline,
) {
  const resolution = await settleNavigationWithin(
    contributor.resolveFocusTarget(value, context),
    { signal: context.signal, timeoutMs: Math.max(1, deadline - Date.now()) },
  );
  if (!resolution.completed) {
    restoration.diagnostic("warn", "contributor-focus-timeout", {
      contributorId: id,
    });
    return Object.freeze({ timedOut: true, attempted: true, restored: false });
  }
  const target = resolution.value;
  if (!target || typeof target.focus !== "function") {
    return Object.freeze({
      timedOut: false,
      attempted: false,
      restored: false,
    });
  }
  const focusResult = await settleNavigationWithin(target.focus(context), {
    signal: context.signal,
    timeoutMs: Math.max(1, deadline - Date.now()),
  });
  if (!focusResult.completed) {
    restoration.diagnostic("warn", "contributor-focus-timeout", {
      contributorId: id,
    });
    return Object.freeze({ timedOut: true, attempted: true, restored: false });
  }
  return Object.freeze({
    timedOut: false,
    attempted: true,
    restored: focusResult.value === true,
  });
}

async function restoreDestination(restoration, request) {
  if (
    !request.destination?.snapshotRef ||
    !requestIsCurrent(restoration, request)
  ) {
    return Object.freeze({ status: "skipped", reason: "restore-superseded" });
  }
  restoration.restoreController?.abort();
  const controller = new AbortController();
  restoration.restoreController = controller;
  restoration.stateSource.restoring = true;
  restoration.deferredScrollFullPath = request.route.fullPath;
  try {
    return await runRestoration(restoration, request, controller);
  } catch (error) {
    if (isNavigationAbortError(error)) {
      return Object.freeze({ status: "skipped", reason: "aborted" });
    }
    restoration.diagnostic("warn", "restore-failed", {
      errorName: String(error?.name || "Error"),
    });
    return Object.freeze({ status: "degraded", reason: "restore-failed" });
  } finally {
    if (restoration.restoreController === controller) {
      restoration.restoreController = null;
      restoration.activeRestoreSnapshot = null;
      restoration.stateSource.restoring = false;
      restoration.deferredScrollFullPath = "";
    }
  }
}

async function runRestoration(restoration, request, controller) {
  const snapshot =
    request.snapshot ||
    (await restoration.repository.readSnapshot(
      request.taskId,
      request.destination.snapshotRef,
    ));
  if (!snapshotMatchesDestination(snapshot, request.destination)) {
    return Object.freeze({
      status: "degraded",
      reason: "snapshot-unavailable",
    });
  }
  if (!requestIsCurrent(restoration, request)) {
    return Object.freeze({ status: "skipped", reason: "restore-superseded" });
  }
  restoration.activeRestoreSnapshot = snapshot;
  const current = restoration.getContext();
  const expected = current.meta?.restore?.length
    ? [...current.meta.restore]
    : Object.keys(snapshot.contributors);
  const registered = await waitForContributors(
    restoration,
    expected,
    controller.signal,
  );
  let degraded = !registered;
  if (!registered) {
    restoration.diagnostic("warn", "contributor-registration-timeout", {
      expectedCount: expected.length,
    });
  }
  const context = createNavigationRestoreContext({
    transactionId: createSecureNavigationId(
      "restore",
      restoration.cryptoObject,
    ),
    reason: request.reason,
    route: request.route,
    browserEntry: current.browserEntry,
    destinationEntry: request.destination,
    scope: current.scope,
    signal: controller.signal,
  });
  const prepared = await prepareContributors(
    restoration,
    expected,
    snapshot,
    context,
  );
  degraded ||= prepared.degraded;
  const structured = await restoreStructures(
    restoration,
    prepared.records,
    context,
  );
  degraded ||= structured.degraded;
  const scroll = await restoreScroll(
    restoration,
    structured.records,
    snapshot,
    context,
  );
  degraded ||= scroll.degraded;
  const focus = await restoreFocus(restoration, structured.records, context);
  degraded ||= focus.degraded;
  return Object.freeze({
    status: degraded ? "degraded" : "restored",
    ...(degraded
      ? { reason: registered ? "partial-restore" : "missing-contributor" }
      : {}),
  });
}

function launchQueuedRestore(restoration) {
  const request = restoration.queuedRestore;
  if (!restoration.appMounted || !request) {
    return;
  }
  if (!requestIsCurrent(restoration, request)) {
    restoration.queuedRestore = null;
    restoration.activeRestoreSnapshot = null;
    return;
  }
  restoration.queuedRestore = null;
  void restoreDestination(restoration, request);
}

async function queueRestore(restoration, destination, reason, route) {
  const current = restoration.getContext();
  const request = {
    taskId: current.taskId,
    browserEntryId: current.browserEntry?.browserEntryId,
    destination,
    reason,
    route,
    snapshot: null,
  };
  const snapshot = destination?.snapshotRef
    ? await restoration.repository.readSnapshot(
        request.taskId,
        destination.snapshotRef,
      )
    : null;
  if (!requestIsCurrent(restoration, request)) {
    return;
  }
  request.snapshot = snapshot;
  if (snapshotMatchesDestination(snapshot, destination)) {
    restoration.activeRestoreSnapshot = snapshot;
  }
  restoration.queuedRestore = request;
  launchQueuedRestore(restoration);
}

function notifyAppMounted(restoration) {
  restoration.ensureActive();
  restoration.appMounted = true;
  launchQueuedRestore(restoration);
}

function peekContributorSnapshot(restoration, contributorId) {
  const id = normalizeText(contributorId);
  const stored = restoration.activeRestoreSnapshot?.contributors?.[id];
  return stored ? readonly(stored) : undefined;
}

function registerContributor(restoration, contributor) {
  restoration.ensureActive();
  const id = normalizeText(contributor?.id);
  const version = Number(contributor?.version);
  if (
    !id ||
    !Number.isInteger(version) ||
    version < 1 ||
    typeof contributor?.capture !== "function"
  ) {
    throw new TypeError(
      "JSKIT navigation contributor requires id, positive version, and capture().",
    );
  }
  const invalidHook = CONTRIBUTOR_HOOKS.find(
    (hook) =>
      contributor[hook] != null && typeof contributor[hook] !== "function",
  );
  if (invalidHook) {
    throw new TypeError(
      `JSKIT navigation contributor hook "${invalidHook}" must be a function.`,
    );
  }
  if (restoration.contributors.has(id)) {
    throw new Error(
      `JSKIT navigation contributor id "${id}" is already registered.`,
    );
  }
  const normalized = Object.freeze({ ...contributor, id, version });
  restoration.contributors.set(id, normalized);
  notifyContributorListeners(restoration);
  return () => {
    if (restoration.contributors.get(id) === normalized) {
      restoration.contributors.delete(id);
      notifyContributorListeners(restoration);
    }
  };
}

function abortRestore(restoration) {
  restoration.restoreController?.abort();
}

function deferScroll(restoration, fullPath) {
  restoration.deferredScrollFullPath = String(fullPath || "");
}

function shouldDeferScroll(restoration, route) {
  const fullPath =
    typeof route === "string"
      ? route
      : String(route?.fullPath || route?.path || "");
  return Boolean(
    restoration.deferredScrollFullPath &&
    fullPath === restoration.deferredScrollFullPath,
  );
}

function setInputModality(restoration, modality) {
  restoration.lastInputModality = modality;
}

function dispose(restoration) {
  restoration.activeCaptureController?.abort();
  restoration.restoreController?.abort();
  restoration.queuedRestore = null;
  restoration.activeRestoreSnapshot = null;
  restoration.contributorListeners.clear();
  restoration.contributors.clear();
}

function createNavigationRestorationCoordinator(options = {}) {
  const restoration = createNavigationRestorationContext(options);

  return Object.freeze({
    capture(destinationEntryId) {
      return capture(restoration, destinationEntryId);
    },
    focusPageHeading() {
      return focusPageHeading(restoration);
    },
    queueRestore(destination, reason, route) {
      return queueRestore(restoration, destination, reason, route);
    },
    notifyAppMounted() {
      return notifyAppMounted(restoration);
    },
    peekContributorSnapshot(contributorId) {
      return peekContributorSnapshot(restoration, contributorId);
    },
    registerContributor(contributor) {
      return registerContributor(restoration, contributor);
    },
    abortRestore() {
      abortRestore(restoration);
    },
    deferScroll(fullPath) {
      deferScroll(restoration, fullPath);
    },
    shouldDeferScroll(route) {
      return shouldDeferScroll(restoration, route);
    },
    setInputModality(modality) {
      setInputModality(restoration, modality);
    },
    dispose() {
      dispose(restoration);
    },
  });
}

export { createNavigationRestorationCoordinator };
