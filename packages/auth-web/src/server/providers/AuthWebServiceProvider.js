import { AuthWebService } from "../services/AuthWebService.js";

function parseBoolean(value, fallback = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function resolveDevAuthBootstrapEnabled(scope) {
  const env =
    scope && typeof scope.has === "function" && scope.has("jskit.env")
      ? scope.make("jskit.env")
      : {};

  return parseBoolean(env?.AUTH_DEV_BYPASS_ENABLED, false) &&
    String(env?.NODE_ENV || "development").trim().toLowerCase() !== "production";
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
