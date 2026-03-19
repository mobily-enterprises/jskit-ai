import { normalizeText } from "./normalize.js";

const ROUTE_VISIBILITY_LEVELS = Object.freeze(["public", "user"]);
const ROUTE_VISIBILITY_LEVEL_SET = new Set(ROUTE_VISIBILITY_LEVELS);

function normalizeRouteVisibility(value, { fallback = "public" } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized) {
    return normalized;
  }

  const normalizedFallback = normalizeText(fallback).toLowerCase();
  if (ROUTE_VISIBILITY_LEVEL_SET.has(normalizedFallback)) {
    return normalizedFallback;
  }

  return "public";
}

function normalizeOwnerId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function normalizeVisibilityContext(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return Object.freeze({
    visibility: normalizeRouteVisibility(source.visibility),
    scopeOwnerId: normalizeOwnerId(source.scopeOwnerId),
    userOwnerId: normalizeOwnerId(source.userOwnerId)
  });
}

export { ROUTE_VISIBILITY_LEVELS, normalizeRouteVisibility, normalizeVisibilityContext };
