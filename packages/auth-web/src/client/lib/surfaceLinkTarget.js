import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";

function resolveSurfaceLinkTarget({
  context = null,
  surface = "",
  explicitTo = "",
  scopedSuffix = "",
  unscopedSuffix = ""
} = {}) {
  const fallbackPath = String(unscopedSuffix || "").trim() || String(scopedSuffix || "").trim() || "/";
  return resolveShellLinkPath({
    context,
    surface,
    explicitTo,
    relativePath: fallbackPath
  });
}

export { resolveSurfaceLinkTarget };
