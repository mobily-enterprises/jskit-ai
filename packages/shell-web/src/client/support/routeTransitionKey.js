import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function resolveShellRouteTransitionKey({
  routePathKey = "",
  routeTransitionName = "",
  surfaceId = ""
} = {}) {
  if (normalizeText(routeTransitionName)) {
    return normalizeText(routePathKey) || "/";
  }

  const surfaceKey = normalizeText(surfaceId);
  if (surfaceKey && surfaceKey !== "*") {
    return `surface:${surfaceKey}`;
  }

  return "stable";
}

export { resolveShellRouteTransitionKey };
