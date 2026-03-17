import {
  isRecord,
  normalizeAction,
  normalizeChannel,
  normalizeNonNegativeInteger,
  normalizeSeverity,
  normalizeText
} from "./normalize.js";
import { createDefaultErrorPolicy } from "./policy.js";

function createRuntimeLogger(logger = null) {
  const source = isRecord(logger) ? logger : null;
  return Object.freeze({
    warn: typeof source?.warn === "function" ? source.warn.bind(source) : () => {},
    error: typeof source?.error === "function" ? source.error.bind(source) : () => {}
  });
}

function normalizeErrorEvent(rawEvent = {}) {
  const source = isRecord(rawEvent) ? rawEvent : { message: rawEvent };
  const cause = source.cause !== undefined ? source.cause : source.error;

  const statusCandidate = Number(
    source.status || source.statusCode || cause?.status || cause?.statusCode || 0
  );
  const status = Number.isFinite(statusCandidate) ? Math.trunc(statusCandidate) : 0;

  const fieldErrors = isRecord(source.fieldErrors)
    ? Object.freeze({ ...source.fieldErrors })
    : isRecord(source.details?.fieldErrors)
      ? Object.freeze({ ...source.details.fieldErrors })
      : null;

  const details = isRecord(source.details) ? Object.freeze({ ...source.details }) : null;

  const userMessage = normalizeText(source.userMessage);
  const runtimeMessage = normalizeText(source.message || cause?.message);

  return Object.freeze({
    code: normalizeText(source.code || cause?.code),
    status,
    source: normalizeText(source.source, "app"),
    message: normalizeText(userMessage || runtimeMessage, "Request failed."),
    userMessage,
    severity: normalizeSeverity(source.severity, "error"),
    channel: normalizeChannel(source.channel),
    presenterId: normalizeText(source.presenterId),
    action: normalizeAction(source.action),
    persist: typeof source.persist === "boolean" ? source.persist : null,
    blocking: source.blocking === true,
    dedupeKey: normalizeText(source.dedupeKey),
    dedupeWindowMs: normalizeNonNegativeInteger(source.dedupeWindowMs, 0),
    traceId: normalizeText(source.traceId),
    fieldErrors,
    details,
    cause: cause || null,
    timestamp: Number(Date.now())
  });
}

function normalizePolicyDecision(policyDecision = {}, event = {}) {
  const source = isRecord(policyDecision) ? policyDecision : {};
  const channel = normalizeChannel(source.channel || event.channel, "snackbar") || "snackbar";

  return Object.freeze({
    channel,
    presenterId: normalizeText(source.presenterId || event.presenterId),
    message: normalizeText(source.message || event.userMessage || event.message, "Request failed."),
    severity: normalizeSeverity(source.severity || event.severity, "error"),
    action: normalizeAction(source.action || event.action),
    persist:
      typeof source.persist === "boolean"
        ? source.persist
        : typeof event.persist === "boolean"
          ? event.persist
          : channel !== "snackbar",
    dedupeKey: normalizeText(source.dedupeKey || event.dedupeKey),
    dedupeWindowMs: normalizeNonNegativeInteger(source.dedupeWindowMs, event.dedupeWindowMs || 0)
  });
}

function normalizePresenter(candidate = {}) {
  const source = isRecord(candidate) ? candidate : {};
  const id = normalizeText(source.id);
  if (!id) {
    throw new Error("Error presenter requires id.");
  }

  if (typeof source.present !== "function") {
    throw new Error(`Error presenter "${id}" requires present(payload).`);
  }

  return Object.freeze({
    id,
    supports: typeof source.supports === "function" ? source.supports.bind(source) : () => true,
    present: source.present.bind(source),
    dismiss: typeof source.dismiss === "function" ? source.dismiss.bind(source) : null
  });
}

function createErrorRuntime({
  presenters = [],
  policy = null,
  defaultPresenterId = "",
  moduleDefaultPresenterId = "",
  logger = null
} = {}) {
  const runtimeLogger = createRuntimeLogger(logger);
  const byPresenterId = new Map();
  const listeners = new Set();
  const dedupeWindowByKey = new Map();
  let activePolicy = typeof policy === "function" ? policy : createDefaultErrorPolicy();
  let activeAppDefaultPresenterId = normalizeText(defaultPresenterId);
  const activeModuleDefaultPresenterId = normalizeText(moduleDefaultPresenterId);

  function getPresenterIds() {
    return Object.freeze([...byPresenterId.keys()].sort((left, right) => left.localeCompare(right)));
  }

  function assertPresenterExists(presenterId, label) {
    if (!byPresenterId.has(presenterId)) {
      throw new Error(`${label} presenter "${presenterId}" is not registered.`);
    }
  }

  function resolveDefaultPresenterId() {
    if (activeAppDefaultPresenterId) {
      assertPresenterExists(activeAppDefaultPresenterId, "App default error");
      return activeAppDefaultPresenterId;
    }

    if (activeModuleDefaultPresenterId) {
      assertPresenterExists(activeModuleDefaultPresenterId, "Module default error");
      return activeModuleDefaultPresenterId;
    }

    throw new Error("Error runtime requires app default presenter or module default presenter.");
  }

  function assertBootReady() {
    resolveDefaultPresenterId();
  }

  function registerPresenter(presenter) {
    const normalized = normalizePresenter(presenter);
    if (byPresenterId.has(normalized.id)) {
      throw new Error(`Error presenter "${normalized.id}" is already registered.`);
    }

    byPresenterId.set(normalized.id, normalized);
    return normalized.id;
  }

  function registerPresenters(nextPresenters = []) {
    const source = Array.isArray(nextPresenters) ? nextPresenters : [];
    const ids = [];
    for (const presenter of source) {
      ids.push(registerPresenter(presenter));
    }
    return Object.freeze(ids);
  }

  function setPolicy(nextPolicy) {
    if (typeof nextPolicy !== "function") {
      throw new TypeError("Error policy must be a function.");
    }
    activePolicy = nextPolicy;
  }

  function setAppDefaultPresenterId(nextDefaultPresenterId = "") {
    const normalized = normalizeText(nextDefaultPresenterId);
    if (normalized) {
      assertPresenterExists(normalized, "App default error");
    }

    activeAppDefaultPresenterId = normalized;
    return activeAppDefaultPresenterId;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function notify(event = {}) {
    const payload = Object.freeze({ ...event });
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        runtimeLogger.warn(
          {
            error: String(error?.message || error || "unknown error")
          },
          "Error runtime subscriber failed."
        );
      }
    }
  }

  function resolvePresenterForDecision(decision) {
    const explicitPresenterId = normalizeText(decision.presenterId);
    if (explicitPresenterId) {
      assertPresenterExists(explicitPresenterId, "Policy-selected error");
      return byPresenterId.get(explicitPresenterId);
    }

    const defaultPresenterId = resolveDefaultPresenterId();
    return byPresenterId.get(defaultPresenterId);
  }

  function shouldSkipByDedupe(decision) {
    if (!decision.dedupeKey || decision.dedupeWindowMs < 1) {
      return false;
    }

    const now = Number(Date.now());
    const previousTimestamp = Number(dedupeWindowByKey.get(decision.dedupeKey) || 0);
    if (now - previousTimestamp < decision.dedupeWindowMs) {
      return true;
    }

    dedupeWindowByKey.set(decision.dedupeKey, now);
    return false;
  }

  function report(rawEvent = {}, rawContext = {}) {
    const event = normalizeErrorEvent(rawEvent);
    const context = isRecord(rawContext) ? Object.freeze({ ...rawContext }) : Object.freeze({});

    let policyDecision;
    try {
      policyDecision = activePolicy(
        event,
        Object.freeze({
          context,
          runtime: Object.freeze({
            presenterIds: getPresenterIds(),
            appDefaultPresenterId: activeAppDefaultPresenterId,
            moduleDefaultPresenterId: activeModuleDefaultPresenterId
          })
        })
      );
    } catch (error) {
      runtimeLogger.error(
        {
          source: event.source,
          error: String(error?.message || error || "unknown error")
        },
        "Error policy threw while evaluating error event."
      );
      throw error;
    }

    const decision = normalizePolicyDecision(policyDecision, event);

    if (decision.channel === "silent") {
      const silentResult = Object.freeze({
        event,
        decision,
        skipped: true,
        reason: "silent"
      });
      notify({
        type: "reported.silent",
        result: silentResult
      });
      return silentResult;
    }

    if (shouldSkipByDedupe(decision)) {
      const dedupedResult = Object.freeze({
        event,
        decision,
        skipped: true,
        reason: "dedupe"
      });
      notify({
        type: "reported.deduped",
        result: dedupedResult
      });
      return dedupedResult;
    }

    const presenter = resolvePresenterForDecision(decision);
    if (!presenter.supports(decision.channel)) {
      throw new Error(
        `Error presenter "${presenter.id}" does not support channel "${decision.channel}".`
      );
    }

    const payload = Object.freeze({
      ...decision,
      presenterId: presenter.id,
      event,
      context
    });

    const presentationId = normalizeText(presenter.present(payload));

    const result = Object.freeze({
      event,
      decision: Object.freeze({
        ...decision,
        presenterId: presenter.id
      }),
      presentationId,
      skipped: false
    });

    notify({
      type: "reported",
      result
    });

    return result;
  }

  function dismiss(presentationId = "", options = {}) {
    const normalizedPresentationId = normalizeText(presentationId);
    const source = isRecord(options) ? options : {};
    const presenterId = normalizeText(source.presenterId);

    if (presenterId) {
      const presenter = byPresenterId.get(presenterId);
      if (!presenter || typeof presenter.dismiss !== "function") {
        return 0;
      }
      return Number(presenter.dismiss(normalizedPresentationId) || 0);
    }

    let total = 0;
    for (const presenter of byPresenterId.values()) {
      if (typeof presenter.dismiss !== "function") {
        continue;
      }
      total += Number(presenter.dismiss(normalizedPresentationId) || 0);
    }
    return total;
  }

  function configure(options = {}) {
    const source = isRecord(options) ? options : {};

    if (Array.isArray(source.presenters) && source.presenters.length > 0) {
      registerPresenters(source.presenters);
    }

    if (Object.prototype.hasOwnProperty.call(source, "policy")) {
      setPolicy(source.policy);
    }

    if (Object.prototype.hasOwnProperty.call(source, "defaultPresenterId")) {
      setAppDefaultPresenterId(source.defaultPresenterId);
    }

    assertBootReady();

    return getSnapshot();
  }

  function getSnapshot() {
    return Object.freeze({
      presenterIds: getPresenterIds(),
      appDefaultPresenterId: activeAppDefaultPresenterId,
      moduleDefaultPresenterId: activeModuleDefaultPresenterId,
      resolvedDefaultPresenterId: resolveDefaultPresenterId()
    });
  }

  registerPresenters(presenters);
  assertBootReady();

  return Object.freeze({
    report,
    dismiss,
    configure,
    registerPresenter,
    registerPresenters,
    setPolicy,
    setAppDefaultPresenterId,
    assertBootReady,
    getSnapshot,
    subscribe,
    normalizeErrorEvent
  });
}

export {
  createErrorRuntime,
  normalizeErrorEvent
};
