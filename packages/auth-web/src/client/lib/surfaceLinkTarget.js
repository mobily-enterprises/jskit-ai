import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";

function resolveSurfaceLinkTarget({
  context = null,
  surface = "",
  surfaceRole = "",
  explicitTo = "",
  workspaceSuffix = "",
  nonWorkspaceSuffix = ""
} = {}) {
  const fallbackPath = String(nonWorkspaceSuffix || "").trim() || String(workspaceSuffix || "").trim() || "/";
  return resolveShellLinkPath({
    context,
    surface,
    surfaceRole,
    explicitTo,
    relativePath: fallbackPath
  });
}

export { resolveSurfaceLinkTarget };
