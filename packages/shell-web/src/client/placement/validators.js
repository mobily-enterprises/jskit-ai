import {
  DEFAULT_WEB_PLACEMENT_ORDER,
  WEB_PLACEMENT_SURFACE_ANY
} from "./tokens.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

function isRenderableComponent(value) {
  if (typeof value === "function") {
    return true;
  }
  return isRecord(value);
}

function normalizeText(value) {
  return String(value || "").trim();
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

function toInteger(value, fallback = DEFAULT_WEB_PLACEMENT_ORDER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function normalizePlacementSlot(value, { strict = false, source = "placement" } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    if (strict) {
      throw new TypeError(`${source} requires slot.`);
    }
    return "";
  }

  const segments = normalized
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    if (strict) {
      throw new TypeError(`${source} slot "${normalized}" must be "<target>.<region>".`);
    }
    return "";
  }

  const target = segments.slice(0, -1).join(".");
  const region = segments[segments.length - 1];
  if (!target || !region) {
    if (strict) {
      throw new TypeError(`${source} slot "${normalized}" must include target and region.`);
    }
    return "";
  }

  return `${target}.${region}`;
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

  const slot = normalizePlacementSlot(value.slot, {
    strict,
    source: `${source} "${id}"`
  });
  if (!slot) {
    return null;
  }

  const componentToken = normalizeText(value.componentToken);
  if (!componentToken) {
    if (strict) {
      throw new TypeError(`${source} "${id}" requires componentToken.`);
    }
    return null;
  }

  const props = isRecord(value.props) ? { ...value.props } : {};
  const when = typeof value.when === "function" ? value.when : null;

  return Object.freeze({
    id,
    slot,
    surface: normalizeSurface(value.surface),
    order: toInteger(value.order, DEFAULT_WEB_PLACEMENT_ORDER),
    componentToken,
    props,
    when,
    enabled: value.enabled !== false
  });
}

function definePlacement(value = {}) {
  return normalizePlacementDefinition(value, {
    strict: true,
    source: "placement contribution"
  });
}

export {
  isRecord,
  isRenderableComponent,
  normalizeSurface,
  normalizePlacementSlot,
  normalizePlacementDefinition,
  definePlacement
};
