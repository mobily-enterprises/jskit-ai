import { readonly, shallowReactive, watchEffect } from "vue";
import { normalizeOptionalText } from "../shared/navigationInternals.js";

function normalizeText(value) {
  return normalizeOptionalText(value) || "";
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

function createNavigationInteractionContext({
  documentObject,
  diagnostic,
  ensureActive,
  onTransientStateChange
}) {
  const blockerStateSource = shallowReactive({
    pending: false,
    blockerId: "",
    title: "Discard changes?",
    message: "Your unsaved changes will be lost."
  });

  return {
    documentObject,
    diagnostic,
    ensureActive,
    onTransientStateChange,
    transientLayers: new Map(),
    navigationBlockers: new Map(),
    transientCloseInFlight: null,
    pendingBlockerDecision: null,
    blockerTriggerElement: null,
    blockerStateSource,
    blockerState: readonly(blockerStateSource)
  };
}

function readTransientLayerOpen(coordinator, record) {
  try {
    return record.layer.isOpen() === true;
  } catch (error) {
    coordinator.diagnostic("warn", "transient-state-failed", {
      id: record.layer.id,
      errorName: String(error?.name || "Error")
    });
    return false;
  }
}

function hasOpenTransientLayer(coordinator) {
  for (const record of coordinator.transientLayers.values()) {
    if (record.open === true) {
      return true;
    }
  }
  return false;
}

async function requestBlockerDecision(coordinator, to, from) {
  for (const blocker of coordinator.navigationBlockers.values()) {
    let blocked = false;
    try {
      blocked = await blocker.isBlocked({ to, from });
    } catch (error) {
      coordinator.diagnostic("warn", "navigation-blocker-failed", {
        blockerId: blocker.id,
        errorName: String(error?.name || "Error")
      });
    }
    if (!blocked) {
      continue;
    }
    if (coordinator.pendingBlockerDecision) {
      return coordinator.pendingBlockerDecision.promise;
    }

    const deferred = createDeferred();
    coordinator.pendingBlockerDecision = deferred;
    coordinator.blockerTriggerElement = coordinator.documentObject?.activeElement || null;
    coordinator.blockerStateSource.pending = true;
    coordinator.blockerStateSource.blockerId = blocker.id;
    coordinator.blockerStateSource.title = blocker.title || "Discard changes?";
    coordinator.blockerStateSource.message = blocker.message || "Your unsaved changes will be lost.";
    return deferred.promise;
  }
  return true;
}

function settleBlocker(coordinator, allowNavigation) {
  const decision = coordinator.pendingBlockerDecision;
  if (!decision) {
    return false;
  }
  coordinator.pendingBlockerDecision = null;
  coordinator.blockerStateSource.pending = false;
  coordinator.blockerStateSource.blockerId = "";
  decision.resolve(allowNavigation === true);
  if (allowNavigation === true) {
    coordinator.blockerTriggerElement = null;
  }
  return true;
}

function restoreBlockedNavigationFocus(coordinator) {
  const target = coordinator.blockerTriggerElement;
  coordinator.blockerTriggerElement = null;
  if (!target || target.isConnected === false || typeof target.focus !== "function") {
    return false;
  }
  target.focus({ preventScroll: true });
  return true;
}

async function performTransientClose(coordinator, record, reason) {
  try {
    const closed = await record.layer.close(reason);
    record.open = readTransientLayerOpen(coordinator, record);
    return Object.freeze({
      status: closed === false ? "blocked" : "completed",
      reason: closed === false ? "transient-layer-blocked" : "transient-layer-closed"
    });
  } catch (error) {
    coordinator.diagnostic("warn", "transient-close-failed", {
      id: record.layer.id,
      errorName: String(error?.name || "Error")
    });
    return Object.freeze({ status: "degraded", reason: "transient-layer-close-failed" });
  } finally {
    coordinator.onTransientStateChange();
  }
}

function findTopTransientLayer(coordinator) {
  let top = null;
  for (const record of coordinator.transientLayers.values()) {
    if (!record.open || (top && top.priority >= record.priority)) {
      continue;
    }
    top = record;
  }
  return top;
}

async function closeTopTransientLayer(coordinator, reason) {
  if (coordinator.transientCloseInFlight) {
    return coordinator.transientCloseInFlight;
  }
  const record = findTopTransientLayer(coordinator);
  if (!record) {
    return null;
  }
  coordinator.transientCloseInFlight = performTransientClose(coordinator, record, reason);
  try {
    return await coordinator.transientCloseInFlight;
  } finally {
    coordinator.transientCloseInFlight = null;
  }
}

function unregisterTransientLayer(coordinator, id, record) {
  if (coordinator.transientLayers.get(id) !== record) {
    return;
  }
  record.stop?.();
  coordinator.transientLayers.delete(id);
  coordinator.onTransientStateChange();
}

function registerTransientLayer(coordinator, layer) {
  coordinator.ensureActive();
  const id = normalizeText(layer?.id);
  if (!id || typeof layer?.isOpen !== "function" || typeof layer?.close !== "function") {
    throw new TypeError("JSKIT transient layer requires id, isOpen(), and close().");
  }
  if (coordinator.transientLayers.has(id)) {
    throw new Error(`JSKIT transient layer id "${id}" is already registered.`);
  }
  const record = {
    layer: Object.freeze({ ...layer, id }),
    priority: Number.isFinite(layer.priority) ? Number(layer.priority) : 0,
    open: false,
    stop: null
  };
  coordinator.transientLayers.set(id, record);
  record.stop = watchEffect(() => {
    record.open = readTransientLayerOpen(coordinator, record);
    coordinator.onTransientStateChange();
  }, { flush: "sync" });

  return function disposeTransientLayer() {
    unregisterTransientLayer(coordinator, id, record);
  };
}

function unregisterBlocker(coordinator, id, blocker) {
  if (coordinator.navigationBlockers.get(id) !== blocker) {
    return;
  }
  coordinator.navigationBlockers.delete(id);
  if (coordinator.blockerStateSource.blockerId === id) {
    settleBlocker(coordinator, false);
  }
}

function registerBlocker(coordinator, blocker) {
  coordinator.ensureActive();
  const id = normalizeText(blocker?.id);
  if (!id || typeof blocker?.isBlocked !== "function") {
    throw new TypeError("JSKIT navigation blocker requires id and isBlocked().");
  }
  if (coordinator.navigationBlockers.has(id)) {
    throw new Error(`Duplicate JSKIT navigation blocker id "${id}".`);
  }
  const normalized = Object.freeze({
    id,
    isBlocked: blocker.isBlocked,
    title: normalizeText(blocker.title),
    message: normalizeText(blocker.message)
  });
  coordinator.navigationBlockers.set(id, normalized);

  return function disposeNavigationBlocker() {
    unregisterBlocker(coordinator, id, normalized);
  };
}

function disposeInteractions(coordinator) {
  settleBlocker(coordinator, false);
  for (const record of coordinator.transientLayers.values()) {
    record.stop?.();
  }
  coordinator.transientLayers.clear();
  coordinator.navigationBlockers.clear();
}

function createNavigationInteractionCoordinator(options = {}) {
  const coordinator = createNavigationInteractionContext(options);

  return Object.freeze({
    blockerState: coordinator.blockerState,
    hasOpenTransientLayer() {
      return hasOpenTransientLayer(coordinator);
    },
    requestBlockerDecision(to, from) {
      return requestBlockerDecision(coordinator, to, from);
    },
    settleBlocker(allowNavigation) {
      return settleBlocker(coordinator, allowNavigation);
    },
    restoreBlockedNavigationFocus() {
      return restoreBlockedNavigationFocus(coordinator);
    },
    closeTopTransientLayer(reason) {
      return closeTopTransientLayer(coordinator, reason);
    },
    registerTransientLayer(layer) {
      return registerTransientLayer(coordinator, layer);
    },
    registerBlocker(blocker) {
      return registerBlocker(coordinator, blocker);
    },
    dispose() {
      disposeInteractions(coordinator);
    }
  });
}

export { createNavigationInteractionCoordinator };
