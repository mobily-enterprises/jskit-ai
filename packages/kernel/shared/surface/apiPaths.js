import { matchesPathPrefix, normalizePathname } from "./paths.js";

const API_BASE_PATH = "/api";
const API_PREFIX = "/api";
const API_PREFIX_SLASH = `${API_PREFIX}/`;
const API_DOCS_PATH = `${API_PREFIX}/docs`;
const API_REALTIME_PATH = `${API_PREFIX}/realtime`;
const VERSIONED_API_PATH_PATTERN = /^\/api\/v[0-9]+(?:$|\/)/;

function normalizeRouteTemplateParams(params = null) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }
  return params;
}

function materializeRouteTemplate(routeTemplate = "/", { params = {}, strictParams = true, context = "materializeRouteTemplate" } = {}) {
  const normalizedTemplate = normalizePathname(routeTemplate);
  const normalizedParams = normalizeRouteTemplateParams(params);
  const missingParams = new Set();
  const outputPath = String(normalizedTemplate || "/").replace(/:([A-Za-z0-9_]+)/g, (_full, rawName) => {
    const paramName = String(rawName || "").trim();
    const rawValue = normalizedParams[paramName];
    const paramValue = String(Array.isArray(rawValue) ? rawValue[0] : rawValue ?? "").trim();
    if (!paramValue) {
      missingParams.add(paramName);
      return `:${paramName}`;
    }
    return encodeURIComponent(paramValue);
  });

  if (strictParams && missingParams.size > 0) {
    throw new Error(`${context} missing required route params: ${[...missingParams].sort().join(", ")}.`);
  }

  return outputPath;
}

function resolveScopedRouteBase(routeBase = "/") {
  const normalizedRouteBase = normalizePathname(routeBase);
  const segments = normalizedRouteBase.split("/").filter(Boolean);
  let lastDynamicIndex = -1;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.startsWith(":") && segment.length > 1) {
      lastDynamicIndex = index;
    }
  }

  if (lastDynamicIndex < 0) {
    return "/";
  }

  return `/${segments.slice(0, lastDynamicIndex + 1).join("/")}`;
}

function resolveScopedApiBasePath({
  routeBase = "/",
  relativePath = "/",
  params = {},
  strictParams = true
} = {}) {
  const scopedRouteBase = resolveScopedRouteBase(routeBase);
  const materializedScopeBase = materializeRouteTemplate(scopedRouteBase, {
    params,
    strictParams,
    context: "resolveScopedApiBasePath"
  });
  const basePath = materializedScopeBase === "/" ? API_BASE_PATH : `${API_BASE_PATH}${materializedScopeBase}`;
  const normalizedRelativePath = normalizePathname(relativePath || "/");

  if (normalizedRelativePath === "/") {
    return basePath;
  }

  return `${basePath}${normalizedRelativePath}`;
}

function isApiPath(pathname) {
  return matchesPathPrefix(pathname, API_BASE_PATH);
}

function isVersionedApiPath(pathname) {
  return VERSIONED_API_PATH_PATTERN.test(normalizePathname(pathname));
}

function toVersionedApiPath(pathname) {
  const normalizedPathname = normalizePathname(pathname);
  if (!isApiPath(normalizedPathname)) {
    return normalizedPathname;
  }

  if (isVersionedApiPath(normalizedPathname)) {
    return normalizedPathname;
  }

  if (normalizedPathname === API_BASE_PATH) {
    return API_PREFIX;
  }

  return `${API_PREFIX}${normalizedPathname.slice(API_BASE_PATH.length)}`;
}

function toVersionedApiPrefix(pathnameOrPrefix) {
  const versionedPath = toVersionedApiPath(pathnameOrPrefix || API_BASE_PATH);
  if (!isApiPath(versionedPath)) {
    return normalizePathname(versionedPath);
  }

  if (versionedPath === API_PREFIX) {
    return API_PREFIX_SLASH;
  }

  return `${versionedPath}/`;
}

function buildVersionedApiPath(suffix) {
  const rawSuffix = String(suffix || "").trim();
  if (!rawSuffix || rawSuffix === "/") {
    return API_PREFIX;
  }

  const normalizedSuffix = normalizePathname(rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`);
  if (isApiPath(normalizedSuffix)) {
    return toVersionedApiPath(normalizedSuffix);
  }

  if (normalizedSuffix === "/") {
    return API_PREFIX;
  }

  return `${API_PREFIX}${normalizedSuffix}`;
}

function isVersionedApiPrefixMatch(pathname) {
  const normalizedPathname = normalizePathname(pathname);
  return normalizedPathname === API_PREFIX || normalizedPathname.startsWith(API_PREFIX_SLASH);
}

export {
  API_BASE_PATH,
  API_PREFIX,
  API_PREFIX_SLASH,
  API_DOCS_PATH,
  API_REALTIME_PATH,
  materializeRouteTemplate,
  normalizePathname,
  isApiPath,
  isVersionedApiPath,
  toVersionedApiPath,
  toVersionedApiPrefix,
  buildVersionedApiPath,
  isVersionedApiPrefixMatch,
  resolveScopedRouteBase,
  resolveScopedApiBasePath
};
