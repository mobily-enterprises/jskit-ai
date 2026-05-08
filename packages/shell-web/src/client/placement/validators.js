import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizePlacementKind,
  normalizePlacementTopologyDefinition,
  normalizeSemanticPlacementId,
  resolvePlacementTargetReference
} from "@jskit-ai/kernel/shared/support/shellLayoutTargets";

const WEB_PLACEMENT_SURFACE_ANY = "*";

function isRenderableComponent(value) {
  if (typeof value === "function") {
    return true;
  }
  return isRecord(value);
}

function normalizeSurface(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return WEB_PLACEMENT_SURFACE_ANY;
  }
  if (normalized === WEB_PLACEMENT_SURFACE_ANY) {
    return WEB_PLACEMENT_SURFACE_ANY;
  }
  return normalized;
}

function isValidSurfaceIdToken(value = "") {
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}

function normalizePlacementSurface(value, { strict = false, source = "placement" } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    if (strict) {
      throw new TypeError(`${source} requires surface id or "*".`);
    }
    return "";
  }

  if (normalized === WEB_PLACEMENT_SURFACE_ANY) {
    return WEB_PLACEMENT_SURFACE_ANY;
  }

  if (isValidSurfaceIdToken(normalized)) {
    return normalized;
  }

  if (strict) {
    throw new TypeError(`${source} surface "${normalized}" is invalid.`);
  }
  return "";
}

function toInteger(value, fallback = 1000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizePlacementTarget(value, { strict = false, source = "placement" } = {}) {
  const reference = resolvePlacementTargetReference(String(value || "").toLowerCase());
  if (reference?.id) {
    return reference.id;
  }

  if (strict) {
    throw new TypeError(`${source} requires semantic target in "area.slot" format or internal concrete target in "host:position" format.`);
  }
  return "";
}

function normalizePlacementSurfaces(value, { strict = false, source = "placement" } = {}) {
  const candidates = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  if (candidates.length < 1) {
    return Object.freeze([WEB_PLACEMENT_SURFACE_ANY]);
  }

  const normalized = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const surface = normalizePlacementSurface(candidate, {
      strict,
      source
    });
    if (!surface || seen.has(surface)) {
      continue;
    }
    if (surface === WEB_PLACEMENT_SURFACE_ANY) {
      return Object.freeze([WEB_PLACEMENT_SURFACE_ANY]);
    }
    seen.add(surface);
    normalized.push(surface);
  }

  if (normalized.length < 1) {
    if (strict) {
      throw new TypeError(`${source} requires at least one valid surface id.`);
    }
    return Object.freeze([WEB_PLACEMENT_SURFACE_ANY]);
  }

  return Object.freeze(normalized);
}

function normalizePlacementDefinition(value, { strict = false, source = "placement" } = {}) {
  if (!isRecord(value)) {
    if (strict) {
      throw new TypeError(`${source} must be an object.`);
    }
    return null;
  }

  if (Object.hasOwn(value, "host") || Object.hasOwn(value, "position")) {
    if (strict) {
      throw new TypeError(`${source} must use "target" only. Legacy "host" and "position" fields are not supported.`);
    }
    return null;
  }

  const id = normalizeText(value.id);
  if (!id) {
    if (strict) {
      throw new TypeError(`${source} requires id.`);
    }
    return null;
  }

  const target = normalizePlacementTarget(value.target, {
    strict,
    source: `${source} "${id}"`
  });
  if (!target) {
    return null;
  }

  const targetReference = resolvePlacementTargetReference(target);
  const internal = value.internal === true;
  if (targetReference?.type === "concrete" && internal !== true) {
    if (strict) {
      throw new TypeError(`${source} "${id}" targets concrete outlet "${target}" without internal: true.`);
    }
    return null;
  }

  const owner = normalizeText(value.owner).toLowerCase();
  const kind = normalizePlacementKind(value.kind) || (normalizeText(value.componentToken) ? "component" : "link");
  const componentToken = normalizeText(value.componentToken);
  if (kind === "component" && !componentToken) {
    if (strict) {
      throw new TypeError(`${source} "${id}" requires componentToken.`);
    }
    return null;
  }

  const props = isRecord(value.props) ? { ...value.props } : {};
  const when = typeof value.when === "function" ? value.when : null;
  const surfaces = normalizePlacementSurfaces(value.surfaces, {
    strict,
    source: `${source} "${id}"`
  });

  return Object.freeze({
    id,
    target,
    targetType: targetReference?.type || "",
    owner,
    kind,
    surfaces,
    order: toInteger(value.order, 1000),
    componentToken,
    props,
    when,
    enabled: value.enabled !== false,
    internal
  });
}

function definePlacement(value = {}) {
  return normalizePlacementDefinition(value, {
    strict: true,
    source: "placement contribution"
  });
}

function definePlacementTopology(value = {}) {
  return normalizePlacementTopologyDefinition(value, {
    context: "placement topology"
  });
}

export {
  isRecord,
  isRenderableComponent,
  normalizeSurface,
  normalizePlacementSurface,
  normalizePlacementTarget,
  normalizePlacementSurfaces,
  normalizePlacementDefinition,
  definePlacement,
  definePlacementTopology,
  normalizeSemanticPlacementId
};
