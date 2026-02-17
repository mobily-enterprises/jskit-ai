import { resolveSurfaceFromPathname } from "../shared/routing/surfacePaths.js";
import { mountAdminApplication } from "./main.admin";
import { mountAppApplication } from "./main.app";

const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
const activeSurface = resolveSurfaceFromPathname(pathname);

if (activeSurface === "app") {
  void mountAppApplication();
} else {
  void mountAdminApplication();
}
