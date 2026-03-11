import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";

function resolveSurfaceLinkTarget({
  context = null,
  surface = "",
  explicitTo = "",
  workspaceSuffix = "/",
  nonWorkspaceSuffix = "/",
  pathname = ""
} = {}) {
  return resolveShellLinkPath({
    context,
    surface,
    explicitTo,
    pathname,
    mode: "auto",
    workspaceRelativePath: workspaceSuffix,
    surfaceRelativePath: nonWorkspaceSuffix
  });
}

export { resolveSurfaceLinkTarget };
