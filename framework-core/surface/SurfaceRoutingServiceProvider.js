import * as apiPaths from "./lib/apiPaths.js";
import * as appSurfaces from "./lib/appSurfaces.js";
import * as paths from "./lib/paths.js";
import * as registry from "./lib/registry.js";
import { escapeRegExp } from "./lib/escapeRegExp.js";

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
