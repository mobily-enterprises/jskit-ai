import { canAccessWorkspace as canAccessAppWorkspace } from "./appSurface.js";
import { canAccessWorkspace as canAccessAdminWorkspace } from "./adminSurface.js";
import { DEFAULT_SURFACE_ID, SURFACE_REGISTRY, normalizeSurfaceId } from "../shared/routing/surfaceRegistry.js";

function denyWorkspaceAccess() {
  return {
    allowed: false,
    reason: "surface_not_supported",
    permissions: []
  };
}

const SURFACE_ACCESS_RULES = {
  app: canAccessAppWorkspace,
  admin: canAccessAdminWorkspace
};

const SURFACES = Object.freeze(
  Object.fromEntries(
    Object.keys(SURFACE_REGISTRY).map((surfaceId) => [
      surfaceId,
      Object.freeze({
        id: surfaceId,
        canAccessWorkspace: SURFACE_ACCESS_RULES[surfaceId] || denyWorkspaceAccess
      })
    ])
  )
);

function resolveSurfaceById(surfaceId) {
  return SURFACES[normalizeSurfaceId(surfaceId)] || SURFACES[DEFAULT_SURFACE_ID];
}

export { SURFACES, normalizeSurfaceId, resolveSurfaceById };
