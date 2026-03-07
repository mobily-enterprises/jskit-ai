import {
  WEB_PLACEMENT_CONTEXT_CONTRIBUTOR_TAG,
  WEB_PLACEMENT_SURFACE_ANY
} from "./tokens.js";
import {
  isRenderableComponent,
  normalizePlacementDefinition,
  normalizePlacementSlot,
  normalizeSurface
} from "./contracts.js";

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createRuntimeLogger(logger) {
  const runtimeLogger = isRecord(logger) ? logger : null;
  return Object.freeze({
    warn: typeof runtimeLogger?.warn === "function" ? runtimeLogger.warn.bind(runtimeLogger) : () => {},
    error: typeof runtimeLogger?.error === "function" ? runtimeLogger.error.bind(runtimeLogger) : () => {}
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

  return [...byId.values()].sort((left, right) => {
    const orderCompare = left.order - right.order;
    if (orderCompare !== 0) {
      return orderCompare;
    }
    return left.id.localeCompare(right.id);
  });
}

function matchesSurface(placementSurface, requestedSurface) {
  if (placementSurface === WEB_PLACEMENT_SURFACE_ANY) {
    return true;
  }
  return placementSurface === requestedSurface;
}

function resolveContextContributors(app, baseContext = {}, logger) {
  const contributors = app.resolveTag(WEB_PLACEMENT_CONTEXT_CONTRIBUTOR_TAG);
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

function resolvePlacementComponent(app, placement, logger, missingTokens) {
  const componentToken = String(placement.componentToken || "").trim();
  if (!componentToken) {
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

  const component = app.make(componentToken);
  if (!isRenderableComponent(component)) {
    logger.warn(
      {
        placementId: placement.id,
        componentToken
      },
      "Skipping placement because component token did not resolve to a Vue component."
    );
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
  let placementDefinitions = Object.freeze([]);

  function replacePlacements(entries = [], { source = "app placement registry" } = {}) {
    placementDefinitions = Object.freeze(normalizePlacementList(entries, { source }));
  }

  function getPlacements({ surface = WEB_PLACEMENT_SURFACE_ANY, slot = "", context = {} } = {}) {
    const normalizedSlot = normalizePlacementSlot(slot, { strict: false });
    if (!normalizedSlot) {
      return Object.freeze([]);
    }

    const normalizedSurface = normalizeSurface(surface);
    const baseContext = isRecord(context) ? { ...context } : {};
    const placementContext = {
      ...baseContext,
      ...resolveContextContributors(
        app,
        {
          app,
          surface: normalizedSurface,
          slot: normalizedSlot,
          context: baseContext
        },
        runtimeLogger
      ),
      app,
      surface: normalizedSurface,
      slot: normalizedSlot
    };

    const matches = [];
    for (const placement of placementDefinitions) {
      if (placement.slot !== normalizedSlot) {
        continue;
      }
      if (!matchesSurface(placement.surface, normalizedSurface)) {
        continue;
      }
      if (!shouldIncludePlacement(placement, placementContext, runtimeLogger)) {
        continue;
      }

      const component = resolvePlacementComponent(app, placement, runtimeLogger, missingTokens);
      if (!component) {
        continue;
      }

      matches.push(
        Object.freeze({
          ...placement,
          component
        })
      );
    }

    return Object.freeze(matches);
  }

  return Object.freeze({
    replacePlacements,
    getPlacements
  });
}

export { createWebPlacementRuntime };
