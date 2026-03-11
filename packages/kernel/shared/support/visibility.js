import { normalizeText } from "./normalize.js";

const ROUTE_VISIBILITY_LEVELS = Object.freeze(["public", "workspace", "user", "workspace_user"]);
const ROUTE_VISIBILITY_LEVEL_SET = new Set(ROUTE_VISIBILITY_LEVELS);

function normalizeRouteVisibility(value, { fallback = "public" } = {}) {
  const normalizedFallback = normalizeText(fallback).toLowerCase();
  const fallbackValue = ROUTE_VISIBILITY_LEVEL_SET.has(normalizedFallback) ? normalizedFallback : "public";
  const normalized = normalizeText(value).toLowerCase();
  return ROUTE_VISIBILITY_LEVEL_SET.has(normalized) ? normalized : fallbackValue;
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
    workspaceOwnerId: normalizeOwnerId(source.workspaceOwnerId),
    userOwnerId: normalizeOwnerId(source.userOwnerId)
  });
}

export { ROUTE_VISIBILITY_LEVELS, normalizeRouteVisibility, normalizeVisibilityContext };
