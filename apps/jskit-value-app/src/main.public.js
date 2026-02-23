import { resolveSurfaceFromPathname } from "../shared/routing/surfacePaths.js";
import { mountAdminApplication } from "./main.admin.public.js";
import { mountAppApplication } from "./main.app.public.js";

const SURFACE_BOOTSTRAP = {
  app: mountAppApplication,
  admin: mountAdminApplication
};

const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
const activeSurface = resolveSurfaceFromPathname(pathname);

if (activeSurface === "console") {
  if (typeof window !== "undefined") {
    window.history.replaceState({}, "", "/login");
  }
  void mountAppApplication();
} else {
  const bootstrapSurface = SURFACE_BOOTSTRAP[activeSurface] || SURFACE_BOOTSTRAP.app;
  if (typeof bootstrapSurface === "function") {
    void bootstrapSurface();
  }
}
