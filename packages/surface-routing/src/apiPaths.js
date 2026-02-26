const API_BASE_PATH = "/api";
const API_MAJOR_VERSION = 1;
const API_VERSION_SEGMENT = `v${API_MAJOR_VERSION}`;
const API_PREFIX = `${API_BASE_PATH}/${API_VERSION_SEGMENT}`;
const API_PREFIX_SLASH = `${API_PREFIX}/`;
const API_DOCS_PATH = `${API_PREFIX}/docs`;
const API_REALTIME_PATH = `${API_PREFIX}/realtime`;
const VERSIONED_API_PATH_PATTERN = /^\/api\/v[0-9]+(?:$|\/)/;

function normalizePathname(pathname) {
  const rawValue = String(pathname || "/").trim();
  if (!rawValue) {
    return "/";
  }

  const withoutQuery = rawValue.split("?")[0].split("#")[0];
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const squashed = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (squashed === "/") {
    return "/";
  }

  return squashed.replace(/\/+$/, "") || "/";
}

function matchesPathPrefix(pathname, prefix) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedPrefix = normalizePathname(prefix);
  return normalizedPathname === normalizedPrefix || normalizedPathname.startsWith(`${normalizedPrefix}/`);
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
  API_MAJOR_VERSION,
  API_VERSION_SEGMENT,
  API_PREFIX,
  API_PREFIX_SLASH,
  API_DOCS_PATH,
  API_REALTIME_PATH,
  normalizePathname,
  isApiPath,
  isVersionedApiPath,
  toVersionedApiPath,
  toVersionedApiPrefix,
  buildVersionedApiPath,
  isVersionedApiPrefixMatch
};
