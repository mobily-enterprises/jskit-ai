import {
  normalizeObject,
  normalizeText
} from "./normalize.js";

const PLACEMENT_LAYOUT_CLASSES = Object.freeze(["compact", "medium", "expanded"]);
const WEB_PLACEMENT_SURFACE_ANY = "*";

function normalizeShellOutletTargetId(value = "") {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }

  const separatorIndex = normalizedValue.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= normalizedValue.length - 1) {
    return "";
  }

  const host = normalizeText(normalizedValue.slice(0, separatorIndex));
  const position = normalizeText(normalizedValue.slice(separatorIndex + 1));
  if (!host || !position) {
    return "";
  }

  return `${host}:${position}`;
}

function normalizeSemanticPlacementId(value = "") {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!normalizedValue || normalizedValue.includes(":") || !normalizedValue.includes(".")) {
    return "";
  }

  const segments = normalizedValue.split(".");
  if (segments.length < 2) {
    return "";
  }

  const normalizedSegments = [];
  for (const segment of segments) {
    const normalizedSegment = normalizeText(segment);
    if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(normalizedSegment)) {
      return "";
    }
    normalizedSegments.push(normalizedSegment);
  }

  return normalizedSegments.join(".");
}

function normalizePlacementOwnerId(value = "") {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!normalizedValue) {
    return "";
  }
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalizedValue)) {
    return "";
  }
  return normalizedValue;
}

function normalizePlacementLayoutClass(value = "") {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (PLACEMENT_LAYOUT_CLASSES.includes(normalizedValue)) {
    return normalizedValue;
  }
  return "";
}

function normalizePlacementKind(value = "") {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (normalizedValue === "link" || normalizedValue === "component") {
    return normalizedValue;
  }
  return "";
}

function normalizePlacementSurfaceId(value = "") {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!normalizedValue) {
    return "";
  }
  if (normalizedValue === WEB_PLACEMENT_SURFACE_ANY) {
    return WEB_PLACEMENT_SURFACE_ANY;
  }
  if (/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalizedValue)) {
    return normalizedValue;
  }
  return "";
}

function normalizePlacementSurfaces(value) {
  const candidates = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  if (candidates.length < 1) {
    return Object.freeze([WEB_PLACEMENT_SURFACE_ANY]);
  }

  const normalized = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const surface = normalizePlacementSurfaceId(candidate);
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
    return Object.freeze([WEB_PLACEMENT_SURFACE_ANY]);
  }

  return Object.freeze(normalized);
}

function resolvePlacementTargetReference(value = "") {
  const semanticId = normalizeSemanticPlacementId(value);
  if (semanticId) {
    return Object.freeze({
      id: semanticId,
      type: "semantic"
    });
  }

  const concreteId = normalizeShellOutletTargetId(value);
  if (concreteId) {
    return Object.freeze({
      id: concreteId,
      type: "concrete"
    });
  }

  return null;
}

function normalizePlacementRenderers(value = {}) {
  const record = normalizeObject(value);
  const renderers = {};
  for (const [key, rendererToken] of Object.entries(record)) {
    const kind = normalizePlacementKind(key);
    const token = normalizeText(rendererToken);
    if (!kind || !token) {
      continue;
    }
    renderers[kind] = token;
  }
  return Object.freeze(renderers);
}

function normalizePlacementTopologyVariant(
  value = {},
  {
    context = "placement topology variant"
  } = {}
) {
  const record = normalizeObject(value);
  const outlet = normalizeShellOutletTargetId(record.outlet || record.target);
  if (!outlet) {
    throw new Error(`${normalizeText(context) || "placement topology variant"} requires outlet in "host:position" format.`);
  }

  return Object.freeze({
    outlet,
    renderers: normalizePlacementRenderers(record.renderers)
  });
}

function normalizePlacementTopologyEntry(
  value = {},
  {
    context = "placement topology"
  } = {}
) {
  const record = normalizeObject(value);
  const resolvedContext = normalizeText(context) || "placement topology";
  const id = normalizeSemanticPlacementId(record.id || record.target);
  if (!id) {
    throw new Error(`${resolvedContext} requires semantic placement id in "area.slot" format.`);
  }

  const owner = normalizePlacementOwnerId(record.owner);
  const surfaces = normalizePlacementSurfaces(record.surfaces);
  const variantsRecord = normalizeObject(record.variants);
  const variants = {};
  for (const layoutClass of PLACEMENT_LAYOUT_CLASSES) {
    const variant = variantsRecord[layoutClass];
    if (!variant) {
      throw new Error(`${resolvedContext} "${id}" requires ${layoutClass} topology variant.`);
    }
    variants[layoutClass] = normalizePlacementTopologyVariant(variant, {
      context: `${resolvedContext} "${id}" ${layoutClass}`
    });
  }

  return Object.freeze({
    id,
    owner,
    description: normalizeText(record.description),
    surfaces,
    default: record.default === true,
    variants: Object.freeze(variants)
  });
}

function normalizePlacementTopologyDefinition(
  value = {},
  {
    context = "placement topology"
  } = {}
) {
  const record = normalizeObject(value);
  const entries = Array.isArray(record.placements) ? record.placements : Array.isArray(value) ? value : [];
  const normalized = [];
  const seen = new Set();
  for (const entry of entries) {
    const placement = normalizePlacementTopologyEntry(entry, { context });
    const key = `${placement.id}::${placement.owner || ""}`;
    if (seen.has(key)) {
      throw new Error(`${normalizeText(context) || "placement topology"} contains duplicate semantic placement "${placement.id}"${placement.owner ? ` for owner "${placement.owner}"` : ""}.`);
    }
    seen.add(key);
    normalized.push(placement);
  }

  return Object.freeze({
    placements: Object.freeze(normalized)
  });
}

export {
  PLACEMENT_LAYOUT_CLASSES,
  WEB_PLACEMENT_SURFACE_ANY,
  normalizePlacementKind,
  normalizePlacementLayoutClass,
  normalizePlacementOwnerId,
  normalizePlacementSurfaceId,
  normalizePlacementSurfaces,
  normalizePlacementTopologyDefinition,
  normalizePlacementTopologyEntry,
  normalizePlacementTopologyVariant,
  normalizeSemanticPlacementId,
  normalizeShellOutletTargetId,
  resolvePlacementTargetReference
};
