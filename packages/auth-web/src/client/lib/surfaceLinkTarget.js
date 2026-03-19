import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";

function resolveSurfaceLinkTarget({
  context = null,
  surface = "",
  explicitTo = "",
  workspaceSuffix = "",
  nonWorkspaceSuffix = ""
} = {}) {
  const fallbackPath = String(nonWorkspaceSuffix || "").trim() || String(workspaceSuffix || "").trim() || "/";
  return resolveShellLinkPath({
    context,
    surface,
    explicitTo,
    relativePath: fallbackPath
  });
}

export { resolveSurfaceLinkTarget };
