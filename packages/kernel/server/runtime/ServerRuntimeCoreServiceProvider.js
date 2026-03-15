import * as apiRouteRegistration from "./apiRouteRegistration.js";
import * as bootstrapContributors from "./bootstrapContributors.js";
import * as bootstrapRoutes from "./bootBootstrapRoutes.js";
import * as canonicalJson from "./canonicalJson.js";
import * as composition from "./composition.js";
import * as errors from "./errors.js";
import * as fastifyBootstrap from "./fastifyBootstrap.js";
import * as integers from "./integers.js";
import * as lockfile from "./lib/lockfile.js";
import * as pagination from "./pagination.js";
import * as realtimeNormalization from "./realtimeNormalization.js";
import * as requestUrl from "./requestUrl.js";
import * as routeUtils from "./routeUtils.js";
import * as runtimeAssembly from "./runtimeAssembly.js";
import * as runtimeKernel from "./runtimeKernel.js";
import * as securityAudit from "./securityAudit.js";
import * as storagePaths from "./storagePaths.js";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";

const SERVER_RUNTIME_CORE_API = Object.freeze({
  apiRouteRegistration: Object.freeze({ ...apiRouteRegistration }),
  bootstrapContributors: Object.freeze({ ...bootstrapContributors }),
  bootstrapRoutes: Object.freeze({ ...bootstrapRoutes }),
  canonicalJson: Object.freeze({ ...canonicalJson }),
  composition: Object.freeze({ ...composition }),
  errors: Object.freeze({ ...errors }),
  fastifyBootstrap: Object.freeze({ ...fastifyBootstrap }),
  integers: Object.freeze({ ...integers }),
  lockfile: Object.freeze({ ...lockfile }),
  pagination: Object.freeze({ ...pagination }),
  realtimeNormalization: Object.freeze({ ...realtimeNormalization }),
  requestUrl: Object.freeze({ ...requestUrl }),
  routeUtils: Object.freeze({ ...routeUtils }),
  runtimeAssembly: Object.freeze({ ...runtimeAssembly }),
  runtimeKernel: Object.freeze({ ...runtimeKernel }),
  securityAudit: Object.freeze({ ...securityAudit }),
  storagePaths: Object.freeze({ ...storagePaths })
});

class ServerRuntimeCoreServiceProvider {
  static id = "runtime.server";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("ServerRuntimeCoreServiceProvider requires application singleton().");
    }

    app.singleton("runtime.server", () => SERVER_RUNTIME_CORE_API);
  }

  boot(app) {
    if (app.has(KERNEL_TOKENS.HttpRouter)) {
      bootstrapRoutes.bootBootstrapRoutes(app);
    }
  }
}

export { ServerRuntimeCoreServiceProvider };
