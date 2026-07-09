import { resolveLocalBackendMode } from "@jskit-ai/auth-provider-local-core/server/providers/AuthLocalServiceProvider";
import { createLocalDbBackend } from "../lib/dbBackend.js";

class AuthLocalDbBackendServiceProvider {
  static id = "auth.provider.local.db";

  static dependsOn = ["runtime.database"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("AuthLocalDbBackendServiceProvider requires application singleton()/has().");
    }

    const backendMode = resolveLocalBackendMode(app);
    if (backendMode !== "db") {
      return;
    }

    if (app.has("auth.local.backend")) {
      throw new Error('AUTH_LOCAL_BACKEND="db" requires auth-provider-local-db-core to own auth.local.backend.');
    }

    app.singleton("auth.local.backend", (scope) => createLocalDbBackend({
      knex: scope.make("jskit.database.knex"),
      transactionManager: scope.make("jskit.database.transactionManager")
    }));
  }
}

export { AuthLocalDbBackendServiceProvider };
