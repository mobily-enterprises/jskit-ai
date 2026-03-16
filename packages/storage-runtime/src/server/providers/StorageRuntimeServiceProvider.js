import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import * as storageBinding from "../storageBinding.js";

const STORAGE_RUNTIME_SERVER_TOKEN = "runtime.storage";
const STORAGE_RUNTIME_SERVER_API = Object.freeze({
  ...storageBinding
});

class StorageRuntimeServiceProvider {
  static id = STORAGE_RUNTIME_SERVER_TOKEN;

  static dependsOn = ["runtime.server"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("StorageRuntimeServiceProvider requires application singleton().");
    }

    app.singleton(STORAGE_RUNTIME_SERVER_TOKEN, () => STORAGE_RUNTIME_SERVER_API);
    app.singleton(KERNEL_TOKENS.Storage, (scope) => storageBinding.createStorageBinding(scope));
  }

  boot() {}
}

export { STORAGE_RUNTIME_SERVER_TOKEN, StorageRuntimeServiceProvider };
