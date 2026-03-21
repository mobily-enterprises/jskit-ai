import {
  resolveRuntimePathname,
  resolveSurfaceIdFromPlacementPathname
} from "@jskit-ai/shell-web/client/placement";
import { extractWorkspaceSlugFromSurfacePathname } from "../lib/workspaceSurfacePaths.js";
import { usersWebHttpClient } from "../lib/httpClient.js";
import { buildBootstrapApiPath } from "../lib/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_STATUSES } from "./bootstrapPlacementRuntimeConstants.js";

function createProviderLogger(app) {
  return Object.freeze({
    warn: (...args) => {
      if (app && typeof app.warn === "function") {
        app.warn(...args);
        return;
      }
      console.warn(...args);
    }
  });
}

function resolveRouteState(placementRuntime, router) {
  const context = placementRuntime.getContext();
  const path = resolveRuntimePathname(router?.currentRoute?.value?.path);
  const surfaceId = String(resolveSurfaceIdFromPlacementPathname(context, path) || "")
    .trim()
    .toLowerCase();
  const workspaceSlug = String(extractWorkspaceSlugFromSurfacePathname(context, surfaceId, path) || "").trim();

  return Object.freeze({
    context,
    path,
    workspaceSlug
  });
}

function normalizeSearch(search = "") {
  const normalizedSearch = String(search || "").trim();
  if (!normalizedSearch) {
    return "";
  }
  return normalizedSearch.startsWith("?") ? normalizedSearch : `?${normalizedSearch}`;
}

function resolveSearchFromFullPath(fullPath = "") {
  const normalizedFullPath = String(fullPath || "").trim();
  const queryStart = normalizedFullPath.indexOf("?");
  if (queryStart < 0) {
    return "";
  }
  const hashStart = normalizedFullPath.indexOf("#", queryStart);
  const search = hashStart < 0 ? normalizedFullPath.slice(queryStart) : normalizedFullPath.slice(queryStart, hashStart);
  return normalizeSearch(search);
}

function normalizeGuardPathname(pathname = "/") {
  return resolveRuntimePathname(pathname);
}

function isGuardDenied(outcome) {
  if (outcome === false) {
    return true;
  }
  if (outcome == null || outcome === true || typeof outcome !== "object" || Array.isArray(outcome)) {
    return false;
  }
  return outcome.allow === false;
}

function resolveErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 0;
}

function normalizeWorkspaceSlugKey(workspaceSlug = "") {
  return String(workspaceSlug || "")
    .trim()
    .toLowerCase();
}

function normalizeWorkspaceBootstrapStatus(status = "") {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (WORKSPACE_BOOTSTRAP_STATUSES.has(normalizedStatus)) {
    return normalizedStatus;
  }
  return "";
}

function resolveRequestedWorkspaceBootstrapStatus(payload = {}, workspaceSlug = "") {
  const normalizedWorkspaceSlug = normalizeWorkspaceSlugKey(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return "";
  }

  const requestedWorkspace =
    payload?.requestedWorkspace && typeof payload.requestedWorkspace === "object" ? payload.requestedWorkspace : null;
  if (!requestedWorkspace) {
    return "";
  }

  const requestedWorkspaceSlug = normalizeWorkspaceSlugKey(requestedWorkspace.slug);
  if (!requestedWorkspaceSlug || requestedWorkspaceSlug !== normalizedWorkspaceSlug) {
    return "";
  }

  return normalizeWorkspaceBootstrapStatus(requestedWorkspace.status);
}

function resolveAuthSignature(context = {}) {
  const auth = context?.auth && typeof context.auth === "object" ? context.auth : {};
  const authenticated = auth.authenticated === true ? "1" : "0";
  const oauthDefaultProvider = String(auth.oauthDefaultProvider || "")
    .trim()
    .toLowerCase();
  const oauthProviders = Array.isArray(auth.oauthProviders)
    ? auth.oauthProviders
        .map((entry) => String(entry?.id || "").trim().toLowerCase())
        .filter(Boolean)
        .join(",")
    : "";

  return `${authenticated}|${oauthDefaultProvider}|${oauthProviders}`;
}

function countPendingInvites(entries = []) {
  if (!Array.isArray(entries)) {
    return 0;
  }

  let total = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    total += 1;
  }
  return total;
}

async function fetchBootstrapPayload(workspaceSlug = "") {
  return usersWebHttpClient.request(buildBootstrapApiPath(workspaceSlug), {
    method: "GET"
  });
}

export {
  countPendingInvites,
  createProviderLogger,
  fetchBootstrapPayload,
  isGuardDenied,
  normalizeGuardPathname,
  normalizeSearch,
  normalizeWorkspaceBootstrapStatus,
  normalizeWorkspaceSlugKey,
  resolveAuthSignature,
  resolveErrorStatusCode,
  resolveRequestedWorkspaceBootstrapStatus,
  resolveRouteState,
  resolveSearchFromFullPath
};
