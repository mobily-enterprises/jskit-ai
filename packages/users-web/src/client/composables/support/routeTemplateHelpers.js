import { unref } from "vue";
import { asPlainObject } from "./scopeHelpers.js";

const ROUTE_PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

function normalizeRouteParamName(value = "", { context = "users-web route param" } = {}) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    throw new TypeError(`${context} must be a non-empty route parameter name.`);
  }
  if (!ROUTE_PARAM_NAME_PATTERN.test(normalizedValue)) {
    throw new TypeError(
      `${context} "${normalizedValue}" is invalid. Use letters, numbers, and underscores only.`
    );
  }

  return normalizedValue;
}

function toRouteParamValue(value) {
  if (Array.isArray(value)) {
    return toRouteParamValue(value[0]);
  }
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function resolveRouteSourceValue(source = null) {
  if (typeof source === "function") {
    return source();
  }

  return unref(source);
}

function resolveRouteParamsSource(source = null) {
  return asPlainObject(resolveRouteSourceValue(source));
}

function normalizeRouteParamNameList(value = []) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function resolveRouteParamNamesSource(source = []) {
  return normalizeRouteParamNameList(resolveRouteSourceValue(source));
}

function normalizeRoutePathname(value = "") {
  const rawPathname = String(value || "").trim();
  const sanitizedPathname = rawPathname.split(/[?#]/u, 1)[0] || "";
  if (!sanitizedPathname) {
    return "/";
  }

  return sanitizedPathname.startsWith("/") ? sanitizedPathname : `/${sanitizedPathname}`;
}

function resolveRoutePathnameSource(source = "") {
  return normalizeRoutePathname(resolveRouteSourceValue(source));
}

function segmentMatchesParamValue(segment = "", paramValue = "") {
  const normalizedSegment = String(segment || "").trim();
  const normalizedParamValue = toRouteParamValue(paramValue);
  if (!normalizedSegment || !normalizedParamValue) {
    return false;
  }

  const encodedParamValue = encodeURIComponent(normalizedParamValue);
  if (normalizedSegment === encodedParamValue) {
    return true;
  }

  try {
    return decodeURIComponent(normalizedSegment) === normalizedParamValue;
  } catch {
    return false;
  }
}

function findRouteParamSegmentIndex(segments = [], paramValue = "", fromIndex = 0) {
  const source = Array.isArray(segments) ? segments : [];
  const cursor = Number.isInteger(fromIndex) && fromIndex > 0 ? fromIndex : 0;
  for (let index = cursor; index < source.length; index += 1) {
    if (segmentMatchesParamValue(source[index], paramValue)) {
      return index;
    }
  }
  return -1;
}

function normalizePathPrefix(segments = [], endIndex = -1) {
  const source = Array.isArray(segments) ? segments : [];
  if (!Number.isInteger(endIndex) || endIndex < 0) {
    return "/";
  }
  return `/${source.slice(0, endIndex + 1).join("/")}`;
}

function resolveAnchorEndIndex(segmentIndex = -1, totalSegments = 0, anchorMode = "at") {
  const normalizedSegmentIndex = Number.isInteger(segmentIndex) ? segmentIndex : -1;
  if (normalizedSegmentIndex < 0) {
    return -1;
  }

  const normalizedTotalSegments = Number.isInteger(totalSegments) && totalSegments > 0 ? totalSegments : 0;
  const normalizedMode = String(anchorMode || "at").trim().toLowerCase();
  if (normalizedMode === "before") {
    return normalizedSegmentIndex - 1;
  }
  if (normalizedMode === "after") {
    return normalizedTotalSegments > 0
      ? Math.min(normalizedSegmentIndex + 1, normalizedTotalSegments - 1)
      : normalizedSegmentIndex + 1;
  }

  return normalizedSegmentIndex;
}

function resolveScopedRoutePathname({
  currentPathname = "/",
  params = {},
  orderedParamNames = [],
  anchorParamName = "",
  anchorParamValue = "",
  anchorMode = "at"
} = {}) {
  const normalizedCurrentPathname = resolveRoutePathnameSource(currentPathname);
  const normalizedAnchorParamName = String(anchorParamName || "").trim();
  if (!normalizedAnchorParamName) {
    return normalizedCurrentPathname;
  }

  const sourceParams = asPlainObject(params);
  const segments = normalizedCurrentPathname.split("/").filter(Boolean);
  if (segments.length < 1) {
    return normalizedCurrentPathname;
  }

  const paramNames = resolveRouteParamNamesSource(orderedParamNames);
  let cursor = 0;
  for (const paramName of paramNames) {
    const segmentIndex = findRouteParamSegmentIndex(segments, sourceParams[paramName], cursor);
    if (segmentIndex < 0) {
      continue;
    }

    if (paramName === normalizedAnchorParamName) {
      const endIndex = resolveAnchorEndIndex(segmentIndex, segments.length, anchorMode);
      return normalizePathPrefix(segments, endIndex);
    }

    cursor = segmentIndex + 1;
  }

  const fallbackAnchorValue = toRouteParamValue(anchorParamValue) ||
    toRouteParamValue(sourceParams[normalizedAnchorParamName]);
  if (!fallbackAnchorValue) {
    return normalizedCurrentPathname;
  }

  const fallbackSegmentIndex = findRouteParamSegmentIndex(segments, fallbackAnchorValue, 0);
  if (fallbackSegmentIndex < 0) {
    return normalizedCurrentPathname;
  }

  const fallbackEndIndex = resolveAnchorEndIndex(fallbackSegmentIndex, segments.length, anchorMode);
  return normalizePathPrefix(segments, fallbackEndIndex);
}

function resolveRouteTemplatePath(routeTemplate = "", params = {}) {
  const normalizedTemplate = String(routeTemplate || "").trim();
  if (!normalizedTemplate) {
    return "";
  }

  const source = asPlainObject(params);
  const missingParams = [];
  const resolvedPath = normalizedTemplate.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, key) => {
    const value = toRouteParamValue(source[key]);
    if (!value) {
      missingParams.push(key);
      return `:${key}`;
    }

    return encodeURIComponent(value);
  });

  if (missingParams.length > 0) {
    return "";
  }

  return resolvedPath;
}

function resolveRouteTemplateLocation(routeTemplate = "", { params = {}, currentPathname = "/" } = {}) {
  const resolvedTemplatePath = resolveRouteTemplatePath(routeTemplate, params);
  if (!resolvedTemplatePath) {
    return "";
  }
  if (resolvedTemplatePath.startsWith("/")) {
    return resolvedTemplatePath;
  }

  const normalizedCurrentPathname = resolveRoutePathnameSource(currentPathname);
  const basePathname = normalizedCurrentPathname.endsWith("/")
    ? normalizedCurrentPathname
    : `${normalizedCurrentPathname}/`;
  const resolvedPathname = new URL(resolvedTemplatePath, `https://jskit.local${basePathname}`).pathname;
  if (resolvedPathname.length > 1 && resolvedPathname.endsWith("/")) {
    return resolvedPathname.slice(0, -1);
  }

  return resolvedPathname;
}

function extractRouteParamNames(pathTemplate = "") {
  const normalizedTemplate = String(pathTemplate || "").trim();
  if (!normalizedTemplate) {
    return [];
  }

  const names = [];
  const seen = new Set();
  const pattern = /:([A-Za-z][A-Za-z0-9_]*)/g;
  let match = null;
  while ((match = pattern.exec(normalizedTemplate)) != null) {
    const name = String(match[1] || "").trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

function resolveRouteParamNamesInOrder(route = null) {
  const sourceRoute = route && typeof route === "object" ? route : {};
  const matched = Array.isArray(sourceRoute.matched) ? sourceRoute.matched : [];
  const names = [];
  const seen = new Set();

  for (const entry of matched) {
    const entryPath = String(entry?.path || "").trim();
    if (!entryPath) {
      continue;
    }
    for (const name of extractRouteParamNames(entryPath)) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      names.push(name);
    }
  }

  if (names.length > 0) {
    return names;
  }

  return Object.keys(asPlainObject(sourceRoute.params))
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

export {
  normalizeRouteParamName,
  toRouteParamValue,
  resolveRouteParamsSource,
  resolveRouteParamNamesSource,
  resolveRoutePathnameSource,
  resolveScopedRoutePathname,
  resolveRouteTemplatePath,
  resolveRouteTemplateLocation,
  extractRouteParamNames,
  resolveRouteParamNamesInOrder
};
