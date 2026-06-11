import { DEFAULT_DEBUG_DEPTH, explodePayload } from "./debug.js";
import { createListenerSubscription } from "@jskit-ai/kernel/shared/support/listenerSet";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizePlacementLayoutClass,
  normalizePlacementTopologyDefinition
} from "@jskit-ai/kernel/shared/support/shellLayoutTargets";
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

function normalizeTopologyList(topology, context = {}) {
  if (Array.isArray(topology)) {
    const normalized = normalizePlacementTopologyDefinition(
      { placements: topology },
      {
        context: context.source || "placement topology"
      }
    );
    return normalizeTopologyList(normalized, context);
  }

  const candidates = ensureArray(topology);
  const entries = [];
  for (const candidate of candidates) {
    const normalized = normalizePlacementTopologyDefinition(candidate, {
      context: context.source || "placement topology"
    });
    entries.push(...normalized.placements);
  }

  const byKey = new Map();
  for (const entry of entries) {
    const key = `${entry.id}::${entry.owner || ""}`;
    if (byKey.has(key)) {
      throw new Error(
        `Duplicate semantic placement "${entry.id}"${entry.owner ? ` for owner "${entry.owner}"` : ""} in ${context.source || "placement topology"}.`
      );
    }
    byKey.set(key, entry);
  }

  return Object.freeze([...byKey.values()]);
}

function matchesSurface(placementSurfaces, requestedSurface) {
  if (requestedSurface === WEB_PLACEMENT_SURFACE_ANY) {
    return true;
  }
  const surfaces = Array.isArray(placementSurfaces) ? placementSurfaces : [WEB_PLACEMENT_SURFACE_ANY];
  return surfaces.includes(WEB_PLACEMENT_SURFACE_ANY) || surfaces.includes(requestedSurface);
}

function resolveTopologyPlacement(topologyEntries = [], placement = {}, requestedSurface = WEB_PLACEMENT_SURFACE_ANY) {
  const semanticTarget = String(placement.target || "").trim();
  const owner = String(placement.owner || "").trim();
  const matches = topologyEntries.filter((entry) => {
    if (entry.id !== semanticTarget) {
      return false;
    }
    if (owner && entry.owner !== owner) {
      return false;
    }
    if (!owner && entry.owner) {
      return false;
    }
    return matchesSurface(entry.surfaces, requestedSurface);
  });

  if (matches.length === 1) {
    return matches[0];
  }
  return null;
}

function resolveRenderablePlacement({
  placement = {},
  topologyEntries = [],
  requestedSurface = WEB_PLACEMENT_SURFACE_ANY,
  requestedTarget = "",
  requestedLayoutClass = "compact"
} = {}) {
  if (placement.targetType === "concrete") {
    if (placement.target !== requestedTarget) {
      return null;
    }
    return placement;
  }

  const topologyPlacement = resolveTopologyPlacement(topologyEntries, placement, requestedSurface);
  if (!topologyPlacement) {
    return null;
  }

  const variant = topologyPlacement.variants?.[requestedLayoutClass] || null;
  if (!variant || variant.outlet !== requestedTarget) {
    return null;
  }

  const componentToken = String(placement.componentToken || variant.renderers?.[placement.kind] || "").trim();
  if (!componentToken) {
    return null;
  }

  return Object.freeze({
    ...placement,
    target: requestedTarget,
    semanticTarget: placement.target,
    topologyOwner: topologyPlacement.owner || "",
    layoutClass: requestedLayoutClass,
    componentToken
  });
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
  let placementTopology = Object.freeze([]);
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

  function replacePlacementTopology(topology = [], { source = "app placement topology" } = {}) {
    missingTokens.clear();
    invalidComponentTokens.clear();
    failedTokens.clear();
    placementTopology = normalizeTopologyList(topology, { source });
    debugLog("replacePlacementTopology", {
      source,
      count: placementTopology.length,
      ids: placementTopology.map((entry) => entry.owner ? `${entry.id}#${entry.owner}` : entry.id)
    });
    notify({
      type: "placement-topology.replaced",
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

  function getPlacements({ surface = WEB_PLACEMENT_SURFACE_ANY, target = "", layoutClass = "", context = {} } = {}) {
    const normalizedTarget = normalizePlacementTarget(target, { strict: false });
    if (!normalizedTarget) {
      return Object.freeze([]);
    }

    const normalizedSurface = normalizeSurface(surface);
    const normalizedLayoutClass =
      normalizePlacementLayoutClass(layoutClass) ||
      normalizePlacementLayoutClass(sharedContext?.layoutClass) ||
      "compact";
    const baseContext = isRecord(context) ? { ...context } : {};
    const contextFromRuntime = isRecord(sharedContext) ? sharedContext : {};
    const contextFromContributors = resolveContextContributors(
      app,
      {
        app,
        surface: normalizedSurface,
        target: normalizedTarget,
        layoutClass: normalizedLayoutClass,
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
      target: normalizedTarget,
      layoutClass: normalizedLayoutClass
    };

    debugLog("getPlacements:start", {
      surface: normalizedSurface,
      target: normalizedTarget,
      layoutClass: normalizedLayoutClass,
      contextKeys: Object.keys(baseContext),
      sharedContextKeys: Object.keys(contextFromRuntime),
      placementCount: placementDefinitions.length,
      topologyCount: placementTopology.length
    });

    const matches = [];
    for (const placement of placementDefinitions) {
      const renderablePlacement = resolveRenderablePlacement({
        placement,
        topologyEntries: placementTopology,
        requestedSurface: normalizedSurface,
        requestedTarget: normalizedTarget,
        requestedLayoutClass: normalizedLayoutClass
      });
      if (!renderablePlacement) {
        continue;
      }
      const placementSurfaces = Array.isArray(renderablePlacement.surfaces)
        ? renderablePlacement.surfaces
        : [WEB_PLACEMENT_SURFACE_ANY];

      if (!matchesSurface(placementSurfaces, normalizedSurface)) {
        debugLog("getPlacements:skip-surfaces", {
          placementId: renderablePlacement.id,
          placementSurfaces,
          requestedSurface: normalizedSurface
        });
        continue;
      }
      if (!shouldIncludePlacement(renderablePlacement, placementContext, runtimeLogger)) {
        debugLog("getPlacements:skip-when", {
          placementId: renderablePlacement.id
        });
        continue;
      }

      const component = resolvePlacementComponent(
        app,
        renderablePlacement,
        runtimeLogger,
        missingTokens,
        invalidComponentTokens,
        failedTokens
      );
      if (!component) {
        debugLog("getPlacements:skip-component", {
          placementId: renderablePlacement.id,
          componentToken: renderablePlacement.componentToken
        });
        continue;
      }

      debugLog("getPlacements:include", {
        placementId: renderablePlacement.id,
        componentToken: renderablePlacement.componentToken,
        placementSurfaces,
        order: renderablePlacement.order
      });

      matches.push(
        Object.freeze({
          ...renderablePlacement,
          component
        })
      );
    }

    debugLog("getPlacements:done", {
      surface: normalizedSurface,
      target: normalizedTarget,
      layoutClass: normalizedLayoutClass,
      resultIds: matches.map((entry) => entry.id)
    });

    return Object.freeze(matches);
  }

  return Object.freeze({
    replacePlacements,
    replacePlacementTopology,
    getPlacements,
    getContext,
    setContext,
    subscribe,
    getRevision
  });
}

export { createWebPlacementRuntime };
