import { START_LOCATION } from "vue-router";
import {
  resolveRuntimePathname,
  resolveSurfaceIdFromPlacementPathname
} from "@jskit-ai/shell-web/client/placement";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";
import { parseWorkspacePathname } from "@jskit-ai/workspaces-core/shared/support/workspacePathModel";
import { extractWorkspaceSlugFromSurfacePathname } from "../lib/workspaceSurfacePaths.js";
import { httpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { buildBootstrapApiPath } from "../lib/bootstrap.js";
import {
  normalizeWorkspaceBootstrapStatusValue
} from "../support/runtimeNormalization.js";
import { WORKSPACE_BOOTSTRAP_STATUSES } from "./bootstrapPlacementRuntimeConstants.js";

// The path of the page the router is on or, before its opening navigation, of the page the tab opened on: until then
// its current route is the start location "/", and that page is its history's location. The first bootstrap, which
// the shell asks for before that navigation, so names the workspace the tab opened, and the guards know its status
// before they let that page open.
function resolveRoutePath(router) {
  const route = router.currentRoute.value;
  if (route !== START_LOCATION) {
    return route.path;
  }
  return String(router.options?.history?.location || "").split(/[?#]/u)[0] || "/";
}

function resolveRouteState(placementRuntime, router) {
  const context = placementRuntime.getContext();
  const path = resolveRuntimePathname(resolveRoutePath(router));
  const surfaceId = String(resolveSurfaceIdFromPlacementPathname(context, path) || "")
    .trim()
    .toLowerCase();
  const workspaceSlugFromSurface = String(extractWorkspaceSlugFromSurfacePathname(context, surfaceId, path) || "").trim();
  const workspaceSlug =
    workspaceSlugFromSurface ||
    String(parseWorkspacePathname(path)?.workspaceSlug || "").trim();

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

function isGuardDenied(outcome) {
  if (outcome === false) {
    return true;
  }
  if (outcome == null || outcome === true || typeof outcome !== "object" || Array.isArray(outcome)) {
    return false;
  }
  return outcome.allow === false;
}

function normalizeWorkspaceBootstrapStatus(status = "") {
  return normalizeWorkspaceBootstrapStatusValue(status, WORKSPACE_BOOTSTRAP_STATUSES);
}

function resolveRequestedWorkspaceBootstrapStatus(payload, workspaceSlug = "") {
  const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return "";
  }

  const requestedWorkspace =
    payload?.requestedWorkspace && typeof payload.requestedWorkspace === "object" ? payload.requestedWorkspace : null;
  if (!requestedWorkspace) {
    return "";
  }

  const requestedWorkspaceSlug = normalizeLowerText(requestedWorkspace.slug);
  if (!requestedWorkspaceSlug || requestedWorkspaceSlug !== normalizedWorkspaceSlug) {
    return "";
  }

  return normalizeWorkspaceBootstrapStatus(requestedWorkspace.status);
}

function resolveAuthSignature(context) {
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
  return httpWebClient.request(buildBootstrapApiPath(workspaceSlug), {
    method: "GET"
  });
}

export {
  countPendingInvites,
  fetchBootstrapPayload,
  isGuardDenied,
  normalizeSearch,
  normalizeWorkspaceBootstrapStatus,
  resolveAuthSignature,
  resolveRequestedWorkspaceBootstrapStatus,
  resolveRouteState,
  resolveSearchFromFullPath
};
