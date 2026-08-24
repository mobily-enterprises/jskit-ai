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
  setup({ appRoot, env }) {
    return {
      storage: createStorageBinding({ env, rootDir: appRoot })
    };
  }
});

export { StorageProvider };
