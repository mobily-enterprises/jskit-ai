import * as storageBinding from "../storageBinding.js";

const STORAGE_RUNTIME_SERVER_API = Object.freeze({
  ...storageBinding
});

class StorageRuntimeServiceProvider {
  static id = "runtime.storage";

  static dependsOn = ["runtime.server"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("StorageRuntimeServiceProvider requires application singleton().");
    }

    app.singleton("runtime.storage", () => STORAGE_RUNTIME_SERVER_API);
    app.singleton("jskit.storage", (scope) => storageBinding.createStorageBinding(scope));
  }

  boot() {}
}

export { StorageRuntimeServiceProvider };
