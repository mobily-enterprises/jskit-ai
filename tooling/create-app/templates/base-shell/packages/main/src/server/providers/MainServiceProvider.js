import { config as publicConfig } from "../../../../../../config/public.js";
import { config as serverConfig } from "../../../../../../config/server.js";

const appConfig = Object.freeze({
  ...(publicConfig && typeof publicConfig === "object" ? publicConfig : {}),
  ...(serverConfig && typeof serverConfig === "object" ? serverConfig : {})
});

class MainServiceProvider {
  static id = "local.main";

  // Optional: register container bindings here (services/singletons).
  register(app) {
    app.instance("appConfig", appConfig);
  }

  // Start backend features here:
  // 1) define shared contracts in `src/shared/schemas`
  // 2) resolve router with `app.make(KERNEL_TOKENS.HttpRouter)`
  // 3) register routes and handlers
  // 4) extract to services/controllers/routes as the feature grows
  boot() {}
}

export { MainServiceProvider };
