import {
  DEFAULT_SURFACE_ID,
  listSurfaceDefinitions,
  normalizeSurfaceId,
  resolveSurfacePrefix as resolveSurfacePrefixFromRegistry
} from "./surfaceRegistry.js";
import { createSurfacePathHelpers } from "@jskit-ai/surface-routing";

const SURFACE_APP = "app";
const SURFACE_ADMIN = "admin";
const SURFACE_CONSOLE = "console";
const ADMIN_SURFACE_PREFIX = resolveSurfacePrefixFromRegistry(SURFACE_ADMIN);
const CONSOLE_SURFACE_PREFIX = resolveSurfacePrefixFromRegistry(SURFACE_CONSOLE);

const {
  normalizePathname,
  matchesPathPrefix,
  resolveSurfaceFromApiPathname,
  resolveSurfaceFromPathname,
  resolveSurfacePrefix,
  withSurfacePrefix,
  createSurfacePaths,
  resolveSurfacePaths
} = createSurfacePathHelpers({
  defaultSurfaceId: DEFAULT_SURFACE_ID,
  normalizeSurfaceId,
  resolveSurfacePrefix: resolveSurfacePrefixFromRegistry,
  listSurfaceDefinitions,
  routes: {
    loginPath: "/login",
    resetPasswordPath: "/reset-password",
    workspacesPath: "/workspaces",
    accountSettingsPath: "/account/settings",
    invitationsPath: "/invitations",
    workspaceBasePath: "/w"
  }
});

export {
  SURFACE_ADMIN,
  SURFACE_APP,
  SURFACE_CONSOLE,
  ADMIN_SURFACE_PREFIX,
  CONSOLE_SURFACE_PREFIX,
  normalizePathname,
  matchesPathPrefix,
  resolveSurfaceFromApiPathname,
  resolveSurfaceFromPathname,
  resolveSurfacePrefix,
  withSurfacePrefix,
  createSurfacePaths,
  resolveSurfacePaths
};
