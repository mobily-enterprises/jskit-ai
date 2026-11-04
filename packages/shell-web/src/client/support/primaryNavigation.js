import { normalizePathname } from "@jskit-ai/kernel/shared";
import { resolveSurfaceNavigationTargetFromPlacementContext } from "../placement/surfaceContext.js";
import {
  normalizeMenuLinkPathname,
  resolveMenuLinkTarget
} from "./menuLinkTarget.js";

function normalizeComparablePathname(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.origin !== window.location.origin) {
      return "";
    }
    return normalizePathname(parsed.pathname);
  } catch {
    return normalizePathname(normalizeMenuLinkPathname(raw));
  }
}

function pathMatchesNavigationEntry(pathname = "", entry = {}) {
  const target = String(entry.pathname || "").trim();
  if (!target) {
    return false;
  }
  if (entry.exact || target === "/") {
    return pathname === target;
  }
  return pathname === target || pathname.startsWith(`${target}/`);
}

// The primary navigation destinations a swipe can reach: same-origin links, in placement order.
function resolvePrimaryNavigationEntries(placements, {
  semanticTarget,
  currentSurfaceId,
  placementContext,
  routeParams
}) {
  return placements
    .filter((entry) => String(entry.semanticTarget || entry.target || "").trim() === semanticTarget)
    .map((entry, index) => {
      const entryProps = entry.props;
      const target = resolveMenuLinkTarget({
        to: entryProps.to,
        surface: entryProps.surface,
        currentSurfaceId,
        placementContext,
        scopedSuffix: entryProps.scopedSuffix,
        unscopedSuffix: entryProps.unscopedSuffix,
        routeParams
      });
      const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext, {
        path: target,
        surfaceId: entryProps.surface || currentSurfaceId
      });

      return Object.freeze({
        id: entry.id,
        index,
        exact: entryProps.exact === true,
        href: navigationTarget.href,
        pathname: normalizeComparablePathname(navigationTarget.href),
        sameOrigin: navigationTarget.sameOrigin
      });
    })
    .filter((entry) => entry.pathname && entry.sameOrigin);
}

// The destination whose path matches most closely, or -1 away from all of them.
function resolveActivePrimaryNavigationIndex(pathname, entries) {
  let bestMatch = null;

  for (const entry of entries) {
    if (!pathMatchesNavigationEntry(pathname, entry)) {
      continue;
    }
    if (!bestMatch || entry.pathname.length > bestMatch.pathname.length) {
      bestMatch = entry;
    }
  }

  return bestMatch ? bestMatch.index : -1;
}

export {
  normalizeComparablePathname,
  resolveActivePrimaryNavigationIndex,
  resolvePrimaryNavigationEntries
};
