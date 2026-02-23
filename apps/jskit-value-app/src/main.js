import { resolveSurfaceFromPathname } from "../shared/routing/surfacePaths.js";
import { DEFAULT_SURFACE_ID } from "../shared/routing/surfaceRegistry.js";
import { mountAdminApplication } from "./main.admin.js";
import { mountAppApplication } from "./main.app.js";
import { mountConsoleApplication } from "./main.console.js";

const SURFACE_BOOTSTRAP = {
  app: mountAppApplication,
  admin: mountAdminApplication,
  console: mountConsoleApplication
};

const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
const activeSurface = resolveSurfaceFromPathname(pathname);
const bootstrapSurface = SURFACE_BOOTSTRAP[activeSurface] || SURFACE_BOOTSTRAP[DEFAULT_SURFACE_ID];
if (typeof bootstrapSurface === "function") {
  void bootstrapSurface();
}
