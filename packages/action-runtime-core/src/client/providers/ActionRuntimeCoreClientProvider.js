import * as actionRuntimeCore from "../../lib/index.js";

const ACTION_RUNTIME_CORE_CLIENT_API = Object.freeze({
  ...actionRuntimeCore
});

class ActionRuntimeCoreClientProvider {
  static id = "runtime.actions.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("ActionRuntimeCoreClientProvider requires application singleton().");
    }

    app.singleton("runtime.actions.client", () => ACTION_RUNTIME_CORE_CLIENT_API);
  }

  boot() {}
}

export { ActionRuntimeCoreClientProvider };
