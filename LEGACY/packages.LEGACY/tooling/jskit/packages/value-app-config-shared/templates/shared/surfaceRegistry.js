import { createDefaultAppSurfaceRegistry } from "@jskit-ai/surface-routing/appSurfaces";

const {
  SURFACE_REGISTRY,
  DEFAULT_SURFACE_ID,
  normalizeSurfaceId,
  resolveSurfacePrefix,
  surfaceRequiresWorkspace,
  listSurfaceDefinitions
} = createDefaultAppSurfaceRegistry();

export {
  SURFACE_REGISTRY,
  DEFAULT_SURFACE_ID,
  normalizeSurfaceId,
  resolveSurfacePrefix,
  surfaceRequiresWorkspace,
  listSurfaceDefinitions
};
