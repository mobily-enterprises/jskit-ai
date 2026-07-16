import { resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import { AuthWebService } from "../services/AuthWebService.js";

function resolveDevAuthBootstrapEnabled(scope) {
  const env =
    scope && typeof scope.has === "function" && scope.has("jskit.env")
      ? scope.make("jskit.env")
      : {};

  const policy = resolveDevAuthPolicyFromEnv(env);
  return policy.enabled && !policy.isProduction;
}

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
      return new AuthWebService({
        getAuthService() {
          return scope.make("authService");
        },
        devAuthBootstrapEnabled: resolveDevAuthBootstrapEnabled(scope)
      });
    });
  }
}

export { AuthWebServiceProvider };
