import { createSurfaceRegistry } from "@jskit-ai/surface-routing";

const {
  SURFACE_REGISTRY,
  DEFAULT_SURFACE_ID,
  normalizeSurfaceId,
  resolveSurfacePrefix,
  surfaceRequiresWorkspace,
  listSurfaceDefinitions
} = createSurfaceRegistry({
  surfaces: {
    app: {
      id: "app",
      prefix: "",
      requiresWorkspace: true
    },
    admin: {
      id: "admin",
      prefix: "/admin",
      requiresWorkspace: true
    },
    console: {
      id: "console",
      prefix: "/console",
      requiresWorkspace: false
    }
  },
  defaultSurfaceId: "app"
});

export {
  SURFACE_REGISTRY,
  DEFAULT_SURFACE_ID,
  normalizeSurfaceId,
  resolveSurfacePrefix,
  surfaceRequiresWorkspace,
  listSurfaceDefinitions
};
