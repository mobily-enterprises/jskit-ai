import { AuthWebService } from "../services/AuthWebService.js";

class AuthWebServiceProvider {
  static id = "auth.web";

  static dependsOn = ["auth.provider"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AuthWebServiceProvider requires application singleton().");
    }

    app.singleton("auth.web.service", (scope) => {
      const authService = scope.make("authService");
      const actionExecutor = scope.make("actionExecutor");
      return new AuthWebService({ authService, actionExecutor });
    });
  }
}

export { AuthWebServiceProvider };
