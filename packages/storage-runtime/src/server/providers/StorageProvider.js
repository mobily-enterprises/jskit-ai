import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createStorageBinding } from "../storageBinding.js";

const StorageProvider = defineProvider({
  id: "runtime.storage",
  requires: {
    appRoot: "runtime.app-root",
    env: "runtime.env"
  },
  provides: {
    storage: "runtime.storage"
  },
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} dependencies.appRoot
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   */
  setup({ appRoot, env }) {
    return {
      storage: createStorageBinding({ env, rootDir: appRoot })
    };
  }
});

export { StorageProvider };
