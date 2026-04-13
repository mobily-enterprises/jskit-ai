import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import { isExternalLinkTarget, splitPathQueryHash } from "@jskit-ai/kernel/shared/support/linkPath";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext,
  resolveSurfacePathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

const ACCOUNT_SURFACE_ID = "account";
const ACCOUNT_SETTINGS_FALLBACK_PATH = "/account";

function resolvePathnameFromLinkTarget(target = "") {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget) {
    return "";
  }

  if (isExternalLinkTarget(normalizedTarget)) {
    try {
      return normalizeText(new URL(normalizedTarget).pathname);
    } catch {
      return "";
    }
  }

  return normalizeText(splitPathQueryHash(normalizedTarget).pathname);
}

function resolveAccountSettingsPathFromPlacementContext(contextValue = null) {
  const accountSurfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(contextValue, ACCOUNT_SURFACE_ID);
  if (!accountSurfaceDefinition) {
    return ACCOUNT_SETTINGS_FALLBACK_PATH;
  }

  return resolveSurfacePathFromPlacementContext(contextValue, ACCOUNT_SURFACE_ID, "/");
}

function resolveFallbackReturnTo({
  currentFullPath = "",
  currentPath = "",
  currentHref = "",
  absolute = false
} = {}) {
  if (absolute) {
    const normalizedCurrentHref = normalizeText(currentHref);
    if (normalizedCurrentHref) {
      return normalizedCurrentHref;
    }
  }

  return normalizeText(currentFullPath) || normalizeText(currentPath) || "/";
}

function appendAccountReturnToIfNeeded(
  target = "",
  {
    placementContext = null,
    currentFullPath = "",
    currentPath = "",
    currentHref = ""
  } = {}
) {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget || normalizedTarget.includes("returnTo=")) {
    return normalizedTarget;
  }

  const targetPathname = resolvePathnameFromLinkTarget(normalizedTarget);
  const accountSettingsPathname = resolvePathnameFromLinkTarget(
    resolveAccountSettingsPathFromPlacementContext(placementContext)
  );
  if (!targetPathname || !accountSettingsPathname || targetPathname !== accountSettingsPathname) {
    return normalizedTarget;
  }

  const accountSettingsTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext, {
    path: normalizedTarget,
    surfaceId: ACCOUNT_SURFACE_ID
  });
  const returnTo = resolveFallbackReturnTo({
    currentFullPath,
    currentPath,
    currentHref,
    absolute: accountSettingsTarget.sameOrigin !== true
  });
  const queryParams = new URLSearchParams({
    returnTo
  });

  return appendQueryString(normalizedTarget, queryParams.toString());
}

export {
  appendAccountReturnToIfNeeded,
  resolveAccountSettingsPathFromPlacementContext
};
