import { canAccessWorkspace as canAccessAppWorkspace } from "./appSurface.js";
import { canAccessWorkspace as canAccessAdminWorkspace } from "./adminSurface.js";

const SURFACES = {
  app: {
    id: "app",
    canAccessWorkspace: canAccessAppWorkspace
  },
  admin: {
    id: "admin",
    canAccessWorkspace: canAccessAdminWorkspace
  }
};

function normalizeSurfaceId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "admin" ? "admin" : "app";
}

function resolveSurfaceById(surfaceId) {
  return SURFACES[normalizeSurfaceId(surfaceId)] || SURFACES.app;
}

export { SURFACES, normalizeSurfaceId, resolveSurfaceById };
