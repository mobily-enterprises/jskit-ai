import { normalizeReturnToPath } from "@jskit-ai/access-core/utils";

function splitPathname(pathValue) {
  const [withoutHash] = String(pathValue || "").split("#");
  const [pathnameOnly] = withoutHash.split("?");
  return pathnameOnly || "";
}

function resolveSearchValue(searchValue) {
  if (typeof searchValue === "string") {
    return searchValue;
  }

  if (typeof window !== "undefined") {
    return String(window.location?.search || "");
  }

  return "";
}

export function resolveRequestedLoginReturnTo({ search } = {}) {
  const searchValue = resolveSearchValue(search);
  const searchParams = new URLSearchParams(searchValue);
  return normalizeReturnToPath(searchParams.get("returnTo"), { fallback: "" });
}

export function resolvePostAuthReturnTo({ surfacePaths = {}, fallbackPath = "/", search } = {}) {
  const fallback = String(fallbackPath || surfacePaths?.rootPath || "/").trim() || "/";
  const requestedReturnTo = resolveRequestedLoginReturnTo({ search });

  if (!requestedReturnTo) {
    return fallback;
  }

  const requestedPathname = splitPathname(requestedReturnTo);
  const loginPath = String(surfacePaths?.loginPath || "").trim();
  const resetPasswordPath = String(surfacePaths?.resetPasswordPath || "").trim();

  if (requestedPathname && (requestedPathname === loginPath || requestedPathname === resetPasswordPath)) {
    return fallback;
  }

  if (typeof surfacePaths?.isPublicAuthPath === "function" && surfacePaths.isPublicAuthPath(requestedPathname)) {
    return fallback;
  }

  return requestedReturnTo;
}

