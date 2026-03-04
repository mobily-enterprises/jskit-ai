import * as apiPaths from "../../shared/surface/apiPaths.js";
import * as appSurfaces from "../../shared/surface/appSurfaces.js";
import * as paths from "../../shared/surface/paths.js";
import * as registry from "../../shared/surface/registry.js";
import { escapeRegExp } from "../../shared/surface/escapeRegExp.js";

const SURFACE_ROUTING_API = Object.freeze({
  apiPaths: Object.freeze({ ...apiPaths }),
  appSurfaces: Object.freeze({ ...appSurfaces }),
  paths: Object.freeze({ ...paths }),
  registry: Object.freeze({ ...registry }),
  escapeRegExp
});

class SurfaceRoutingServiceProvider {
  static id = "runtime.surface-routing";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("SurfaceRoutingServiceProvider requires application singleton().");
    }

    app.singleton("runtime.surface-routing", () => SURFACE_ROUTING_API);
  }

  boot() {}
}

export { SurfaceRoutingServiceProvider };
