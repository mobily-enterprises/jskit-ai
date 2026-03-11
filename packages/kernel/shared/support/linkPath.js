import { normalizePathname } from "../surface/paths.js";

const EXTERNAL_LINK_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function isExternalLinkTarget(target = "") {
  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget) {
    return false;
  }
  if (normalizedTarget.startsWith("//")) {
    return true;
  }
  return EXTERNAL_LINK_PATTERN.test(normalizedTarget);
}

function splitPathQueryHash(target = "") {
  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget) {
    return Object.freeze({
      pathname: "",
      search: "",
      hash: ""
    });
  }

  const hashIndex = normalizedTarget.indexOf("#");
  const beforeHash = hashIndex >= 0 ? normalizedTarget.slice(0, hashIndex) : normalizedTarget;
  const hash = hashIndex >= 0 ? normalizedTarget.slice(hashIndex) : "";
  const queryIndex = beforeHash.indexOf("?");
  const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const search = queryIndex >= 0 ? beforeHash.slice(queryIndex) : "";

  return Object.freeze({
    pathname,
    search,
    hash
  });
}

function resolveLinkPath(basePath = "/", relativePath = "/") {
  const normalizedRelativePath = String(relativePath || "").trim();
  if (isExternalLinkTarget(normalizedRelativePath)) {
    return normalizedRelativePath;
  }

  const normalizedBasePath = normalizePathname(basePath || "/");
  if (!normalizedRelativePath) {
    return normalizedBasePath;
  }

  const { pathname, search, hash } = splitPathQueryHash(normalizedRelativePath);
  if (!pathname) {
    return `${normalizedBasePath}${search}${hash}`;
  }

  const normalizedPathname = normalizePathname(pathname.startsWith("/") ? pathname : `/${pathname}`);
  const resolvedPathname =
    normalizedBasePath === "/"
      ? normalizedPathname
      : normalizedPathname === "/"
        ? normalizedBasePath
        : `${normalizedBasePath}${normalizedPathname}`;

  return `${resolvedPathname}${search}${hash}`;
}

export { isExternalLinkTarget, splitPathQueryHash, resolveLinkPath };
