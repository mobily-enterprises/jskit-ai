import { AuthWebService } from "../services/AuthWebService.js";

class AuthWebServiceProvider {
  static id = "auth.web";

  static dependsOn = ["auth.provider"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("AuthWebServiceProvider requires application singleton()/has().");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("AuthWebServiceProvider requires actionExecutor binding.");
    }

    app.singleton("auth.web.service", (scope) => {
      const authService = scope.make("authService");
      return new AuthWebService({ authService });
    });
  }
}

export { AuthWebServiceProvider };
