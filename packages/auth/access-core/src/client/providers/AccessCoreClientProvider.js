import { createApi as createAuthApi } from "../authApi.js";
import { runAuthSignOutFlow } from "../signOutFlow.js";

const CLIENT_API = Object.freeze({
  createAuthApi,
  runAuthSignOutFlow
});

class AccessCoreClientProvider {
  static id = "auth.access.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AccessCoreClientProvider requires application singleton().");
    }

    app.singleton("auth.access.client", () => CLIENT_API);
  }

  boot() {}
}

export { AccessCoreClientProvider };
