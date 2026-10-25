import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  WEB_PLACEMENT_SURFACE_ANY,
  normalizePlacementKind,
  normalizePlacementSurfaceId,
  normalizePlacementSurfaces as normalizeKernelPlacementSurfaces,
  normalizePlacementTopologyDefinition,
  resolvePlacementTargetReference
} from "@jskit-ai/kernel/shared/support/shellLayoutTargets";

function isRenderableComponent(value) {
  if (typeof value === "function") {
    return true;
  }
  return isRecord(value);
}

function normalizeSurface(value) {
  return normalizeText(value).toLowerCase() || WEB_PLACEMENT_SURFACE_ANY;
}

function normalizePlacementSurface(value, { strict = false, source = "placement" } = {}) {
  const surface = normalizePlacementSurfaceId(value);
  if (!surface && strict) {
    const normalized = normalizeText(value).toLowerCase();
    throw new TypeError(normalized ? `${source} surface "${normalized}" is invalid.` : `${source} requires surface id or "*".`);
  }
  return surface;
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
  if (strict) {
    // Strict callers fail on the first invalid surface the kernel would otherwise drop; "*" ends the list.
    const candidates = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    for (const candidate of candidates) {
      if (normalizePlacementSurface(candidate, { strict, source }) === WEB_PLACEMENT_SURFACE_ANY) {
        break;
      }
    }
  }
  return normalizeKernelPlacementSurfaces(value);
}

function normalizePlacementDefinition(value, { strict = false, source = "placement" } = {}) {
  if (!isRecord(value)) {
    if (strict) {
      throw new TypeError(`${source} must be an object.`);
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
  isRenderableComponent,
  normalizeSurface,
  normalizePlacementSurface,
  normalizePlacementTarget,
  normalizePlacementSurfaces,
  normalizePlacementDefinition,
  definePlacement,
  definePlacementTopology
};
