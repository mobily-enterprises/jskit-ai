import * as apiPaths from "../../lib/apiPaths.js";
import * as appSurfaces from "../../lib/appSurfaces.js";
import * as paths from "../../lib/paths.js";
import * as registry from "../../lib/registry.js";
import { escapeRegExp } from "../../lib/escapeRegExp.js";

const SURFACE_ROUTING_CLIENT_API = Object.freeze({
  apiPaths: Object.freeze({ ...apiPaths }),
  appSurfaces: Object.freeze({ ...appSurfaces }),
  paths: Object.freeze({ ...paths }),
  registry: Object.freeze({ ...registry }),
  escapeRegExp
});

class SurfaceRoutingClientProvider {
  static id = "runtime.surface-routing.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("SurfaceRoutingClientProvider requires application singleton().");
    }

    app.singleton("runtime.surface-routing.client", () => SURFACE_ROUTING_CLIENT_API);
  }

  boot() {}
}

export { SurfaceRoutingClientProvider };
