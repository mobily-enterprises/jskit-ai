import { DEFAULT_DEBUG_DEPTH, explodePayload } from "./debug.js";
import { createListenerSubscription } from "@jskit-ai/kernel/shared/support/listenerSet";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import {
  isRenderableComponent,
  normalizePlacementDefinition,
  normalizePlacementTarget,
  normalizeSurface
} from "./validators.js";

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

const PLACEMENT_DEBUG_PREFIX = "[placement-debug]";
const PLACEMENT_DEBUG_FLAG = "__JSKIT_PLACEMENT_DEBUG__";
const WEB_PLACEMENT_SURFACE_ANY = "*";
const NOOP = () => {};

function isPlacementDebugEnabled() {
  if (typeof globalThis !== "object" || !globalThis) {
    return false;
  }

  return globalThis[PLACEMENT_DEBUG_FLAG] === true;
}

function debugLog(message, payload = null) {
  if (!isPlacementDebugEnabled()) {
    return;
  }

  if (payload === null || payload === undefined) {
    console.log(`${PLACEMENT_DEBUG_PREFIX} ${message}`);
    return;
  }
  const terminalPayload = explodePayload(payload, DEFAULT_DEBUG_DEPTH);
  const rendered = JSON.stringify(terminalPayload, null, 2);
  console.log(`${PLACEMENT_DEBUG_PREFIX} ${message}\n${rendered}`);
}

function createRuntimeLogger(logger) {
  const runtimeLogger = isRecord(logger) ? logger : {};
  let warn = NOOP;
  let error = NOOP;

  if (typeof runtimeLogger.warn === "function") {
    warn = runtimeLogger.warn.bind(runtimeLogger);
  }
  if (typeof runtimeLogger.error === "function") {
    error = runtimeLogger.error.bind(runtimeLogger);
  }

  return Object.freeze({
    warn,
    error
  });
}

function normalizePlacementList(placements, context = {}) {
  const normalized = [];

  for (const candidate of ensureArray(placements)) {
    const placement = normalizePlacementDefinition(candidate, {
      strict: false,
      source: "app placement"
    });
    if (!placement || placement.enabled === false) {
      continue;
    }
    normalized.push(placement);
  }

  const byId = new Map();
  for (const placement of normalized) {
    if (byId.has(placement.id)) {
      throw new Error(`Duplicate placement id "${placement.id}" in ${context.source || "placement list"}.`);
    }
    byId.set(placement.id, placement);
  }

  return [...byId.values()]
    .map((placement, index) => ({
      placement,
      index
    }))
    .sort((left, right) => {
      const orderCompare = left.placement.order - right.placement.order;
      if (orderCompare !== 0) {
        return orderCompare;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.placement);
}

function matchesSurface(placementSurfaces, requestedSurface) {
  if (requestedSurface === WEB_PLACEMENT_SURFACE_ANY) {
    return true;
  }
  const surfaces = Array.isArray(placementSurfaces) ? placementSurfaces : [WEB_PLACEMENT_SURFACE_ANY];
  return surfaces.includes(WEB_PLACEMENT_SURFACE_ANY) || surfaces.includes(requestedSurface);
}

function resolveContextContributors(app, baseContext = {}, logger) {
  const contributors = app.resolveTag("web-placement.context.client");
  let merged = {};

  for (const contributor of ensureArray(contributors)) {
    try {
      const resolved = typeof contributor === "function" ? contributor(Object.freeze({ ...baseContext })) : contributor;
      if (isRecord(resolved)) {
        merged = {
          ...merged,
          ...resolved
        };
      }
    } catch (error) {
      logger.warn(
        {
          contributor,
          error: String(error?.message || error || "unknown error")
        },
        "Failed to evaluate web placement context contributor."
      );
    }
  }

  return merged;
}

function resolvePlacementComponent(
  app,
  placement,
  logger,
  missingTokens,
  invalidComponentTokens,
  failedTokens
) {
  const componentToken = String(placement.componentToken || "").trim();
  if (!componentToken) {
    return null;
  }

  if (invalidComponentTokens.has(componentToken) || failedTokens.has(componentToken)) {
    return null;
  }

  if (!app.has(componentToken)) {
    if (!missingTokens.has(componentToken)) {
      missingTokens.add(componentToken);
      logger.warn(
        {
          placementId: placement.id,
          componentToken
        },
        "Skipping placement because component token is not bound."
      );
    }
    return null;
  }

  let component = null;
  try {
    component = app.make(componentToken);
  } catch (error) {
    if (!failedTokens.has(componentToken)) {
      failedTokens.add(componentToken);
      logger.error(
        {
          placementId: placement.id,
          componentToken,
          error: String(error?.message || error || "unknown error")
        },
        "Skipping placement because component token resolution threw."
      );
    }
    return null;
  }

  if (!isRenderableComponent(component)) {
    if (!invalidComponentTokens.has(componentToken)) {
      invalidComponentTokens.add(componentToken);
      logger.warn(
        {
          placementId: placement.id,
          componentToken
        },
        "Skipping placement because component token did not resolve to a Vue component."
      );
    }
    return null;
  }

  return component;
}

function shouldIncludePlacement(placement, placementContext, logger) {
  if (typeof placement.when !== "function") {
    return true;
  }

  try {
    return placement.when(Object.freeze({ ...placementContext })) === true;
  } catch (error) {
    logger.warn(
      {
        placementId: placement.id,
        error: String(error?.message || error || "unknown error")
      },
      "Placement when() predicate failed; placement was skipped."
    );
    return false;
  }
}

function createWebPlacementRuntime({ app, logger = null } = {}) {
  if (!app || typeof app.resolveTag !== "function" || typeof app.make !== "function" || typeof app.has !== "function") {
    throw new Error("createWebPlacementRuntime requires app.resolveTag(), app.has(), and app.make().");
  }

  const runtimeLogger = createRuntimeLogger(logger);
  const missingTokens = new Set();
  const invalidComponentTokens = new Set();
  const failedTokens = new Set();
  const listeners = new Set();
  const subscribe = createListenerSubscription(listeners);
  let placementDefinitions = Object.freeze([]);
  let sharedContext = Object.freeze({});
  let revision = 0;

  function notify(event = {}) {
    revision += 1;
    debugLog("notify", {
      revision,
      event
    });
    for (const listener of listeners) {
      try {
        listener(
          Object.freeze({
            revision,
            ...event
          })
        );
      } catch (error) {
        runtimeLogger.warn(
          {
            error: String(error?.message || error || "unknown error")
          },
          "Web placement runtime listener threw during notification."
        );
      }
    }
  }

  function replacePlacements(entries = [], { source = "app placement registry" } = {}) {
    missingTokens.clear();
    invalidComponentTokens.clear();
    failedTokens.clear();
    placementDefinitions = Object.freeze(normalizePlacementList(entries, { source }));
    debugLog("replacePlacements", {
      source,
      count: placementDefinitions.length,
      ids: placementDefinitions.map((entry) => entry.id)
    });
    notify({
      type: "placements.replaced",
      source
    });
  }

  function getContext() {
    return sharedContext;
  }

  function setContext(value = {}, { replace = false, source = "placement-context" } = {}) {
    const next = isRecord(value) ? { ...value } : {};

    let nextContext = next;
    if (!replace) {
      nextContext = {
        ...sharedContext,
        ...next
      };
    }

    sharedContext = Object.freeze(nextContext);
    debugLog("setContext", {
      replace,
      source,
      keys: Object.keys(sharedContext)
    });
    notify({
      type: "context.updated",
      source
    });
    return sharedContext;
  }

  function getRevision() {
    return revision;
  }

  function getPlacements({ surface = WEB_PLACEMENT_SURFACE_ANY, target = "", context = {} } = {}) {
    const normalizedTarget = normalizePlacementTarget(target, { strict: false });
    if (!normalizedTarget) {
      return Object.freeze([]);
    }

    const normalizedSurface = normalizeSurface(surface);
    const baseContext = isRecord(context) ? { ...context } : {};
    const contextFromRuntime = isRecord(sharedContext) ? sharedContext : {};
    const contextFromContributors = resolveContextContributors(
      app,
      {
        app,
        surface: normalizedSurface,
        target: normalizedTarget,
        context: {
          ...contextFromRuntime,
          ...baseContext
        }
      },
      runtimeLogger
    );
    const placementContext = {
      ...contextFromContributors,
      ...contextFromRuntime,
      ...baseContext,
      app,
      surface: normalizedSurface,
      target: normalizedTarget
    };

    debugLog("getPlacements:start", {
      surface: normalizedSurface,
      target: normalizedTarget,
      contextKeys: Object.keys(baseContext),
      sharedContextKeys: Object.keys(contextFromRuntime),
      placementCount: placementDefinitions.length
    });

    const matches = [];
    for (const placement of placementDefinitions) {
      if (placement.target !== normalizedTarget) {
        continue;
      }
      const placementSurfaces = Array.isArray(placement.surfaces)
        ? placement.surfaces
        : [WEB_PLACEMENT_SURFACE_ANY];

      if (!matchesSurface(placementSurfaces, normalizedSurface)) {
        debugLog("getPlacements:skip-surfaces", {
          placementId: placement.id,
          placementSurfaces,
          requestedSurface: normalizedSurface
        });
        continue;
      }
      if (!shouldIncludePlacement(placement, placementContext, runtimeLogger)) {
        debugLog("getPlacements:skip-when", {
          placementId: placement.id
        });
        continue;
      }

      const component = resolvePlacementComponent(
        app,
        placement,
        runtimeLogger,
        missingTokens,
        invalidComponentTokens,
        failedTokens
      );
      if (!component) {
        debugLog("getPlacements:skip-component", {
          placementId: placement.id,
          componentToken: placement.componentToken
        });
        continue;
      }

      debugLog("getPlacements:include", {
        placementId: placement.id,
        componentToken: placement.componentToken,
        placementSurfaces,
        order: placement.order
      });

      matches.push(
        Object.freeze({
          ...placement,
          component
        })
      );
    }

    debugLog("getPlacements:done", {
      surface: normalizedSurface,
      target: normalizedTarget,
      resultIds: matches.map((entry) => entry.id)
    });

    return Object.freeze(matches);
  }

  return Object.freeze({
    replacePlacements,
    getPlacements,
    getContext,
    setContext,
    subscribe,
    getRevision
  });
}

export { createWebPlacementRuntime };
