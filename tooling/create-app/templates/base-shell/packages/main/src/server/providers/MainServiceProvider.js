import { loadAppConfig } from "../support/loadAppConfig.js";

class MainServiceProvider {
  static id = "local.main";

  // Optional: register container bindings here (services/singletons).
  async register(app) {
    const appConfig = await loadAppConfig({
      moduleUrl: import.meta.url
    });
    app.instance("appConfig", appConfig);
  }

  // Start backend features here:
  // 1) define shared validators/resources in `src/shared/schemas`
  // 2) resolve router with `app.make("jskit.http.router")`
  // 3) register routes and handlers
  // 4) extract to services/controllers/routes as the feature grows
  boot() {}
}

export { MainServiceProvider };
