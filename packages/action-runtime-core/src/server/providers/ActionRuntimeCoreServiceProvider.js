import * as actionRuntimeCore from "../../lib/index.js";

const ACTION_RUNTIME_CORE_API = Object.freeze({
  ...actionRuntimeCore
});

class ActionRuntimeCoreServiceProvider {
  static id = "runtime.actions";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("ActionRuntimeCoreServiceProvider requires application singleton().");
    }

    app.singleton("runtime.actions", () => ACTION_RUNTIME_CORE_API);
  }

  boot() {}
}

export { ActionRuntimeCoreServiceProvider };
