import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";

function resolveSurfaceLinkTarget({
  context = null,
  surface = "",
  surfaceRole = "",
  explicitTo = "",
  workspaceSuffix = "/",
  nonWorkspaceSuffix = "/",
  pathname = ""
} = {}) {
  return resolveShellLinkPath({
    context,
    surface,
    surfaceRole,
    explicitTo,
    pathname,
    mode: "auto",
    workspaceRelativePath: workspaceSuffix,
    surfaceRelativePath: nonWorkspaceSuffix
  });
}

export { resolveSurfaceLinkTarget };
