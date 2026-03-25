import * as apiRouteRegistration from "./apiRouteRegistration.js";
import * as bootstrapContributors from "../registries/bootstrapPayloadContributorRegistry.js";
import * as bootstrapRoutes from "./bootBootstrapRoutes.js";
import * as canonicalJson from "./canonicalJson.js";
import * as composition from "./composition.js";
import * as domainEvents from "../registries/domainEventListenerRegistry.js";
import * as errors from "./errors.js";
import * as fastifyBootstrap from "./fastifyBootstrap.js";
import * as integers from "./integers.js";
import * as pagination from "./pagination.js";
import * as realtimeNormalization from "./realtimeNormalization.js";
import * as requestUrl from "./requestUrl.js";
import * as routeUtils from "./routeUtils.js";
import * as runtimeAssembly from "./runtimeAssembly.js";
import * as runtimeKernel from "./runtimeKernel.js";
import * as serviceAuthorization from "./serviceAuthorization.js";
import * as serviceRegistration from "../registries/serviceRegistrationRegistry.js";
import * as entityChangeEvents from "./entityChangeEvents.js";
import * as securityAudit from "./securityAudit.js";

const SERVER_RUNTIME_CORE_API = Object.freeze({
  apiRouteRegistration: Object.freeze({ ...apiRouteRegistration }),
  bootstrapContributors: Object.freeze({ ...bootstrapContributors }),
  bootstrapRoutes: Object.freeze({ ...bootstrapRoutes }),
  canonicalJson: Object.freeze({ ...canonicalJson }),
  composition: Object.freeze({ ...composition }),
  domainEvents: Object.freeze({ ...domainEvents }),
  errors: Object.freeze({ ...errors }),
  fastifyBootstrap: Object.freeze({ ...fastifyBootstrap }),
  integers: Object.freeze({ ...integers }),
  pagination: Object.freeze({ ...pagination }),
  realtimeNormalization: Object.freeze({ ...realtimeNormalization }),
  requestUrl: Object.freeze({ ...requestUrl }),
  routeUtils: Object.freeze({ ...routeUtils }),
  runtimeAssembly: Object.freeze({ ...runtimeAssembly }),
  runtimeKernel: Object.freeze({ ...runtimeKernel }),
  serviceAuthorization: Object.freeze({ ...serviceAuthorization }),
  serviceRegistration: Object.freeze({ ...serviceRegistration }),
  entityChangeEvents: Object.freeze({ ...entityChangeEvents }),
  securityAudit: Object.freeze({ ...securityAudit })
});

class ServerRuntimeCoreServiceProvider {
  static id = "runtime.server";

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("ServerRuntimeCoreServiceProvider requires application singleton()/has().");
    }

    serviceRegistration.installServiceRegistrationApi(app);

    app.singleton("runtime.server", () => SERVER_RUNTIME_CORE_API);
    app.singleton("domainEvents", (scope) => domainEvents.createDomainEvents(scope));
  }

  boot(app) {
    if (app.has("jskit.http.router")) {
      bootstrapRoutes.bootBootstrapRoutes(app);
    }
  }
}

export { ServerRuntimeCoreServiceProvider };
