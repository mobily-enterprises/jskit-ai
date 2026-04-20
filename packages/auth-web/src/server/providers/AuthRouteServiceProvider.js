import { AuthController } from "../controllers/AuthController.js";
import { buildRoutes } from "../routes/authRoutes.js";

class AuthRouteServiceProvider {
  static id = "auth.routes";

  static dependsOn = ["auth.web"];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("AuthRouteServiceProvider requires application has().");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthRouteServiceProvider requires application make().");
    }

    const router = app.make("jskit.http.router");
    const authWebService = app.make("auth.web.service");
    const controller = new AuthController({ service: authWebService });
    const routes = buildRoutes(controller, {
      includeDevLoginAs:
        typeof authWebService?.isDevLoginAsAvailable === "function" ? authWebService.isDevLoginAsAvailable() : false
    });
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { AuthRouteServiceProvider };
