import { createProviderRuntimeApp, createProviderRuntimeFromApp } from "./providerRuntime.js";
import {
  createPlatformRuntimeBundle,
  createServerRuntime,
  createServerRuntimeWithPlatformBundle
} from "./runtime.js";

const PLATFORM_SERVER_RUNTIME_API = Object.freeze({
  createPlatformRuntimeBundle,
  createServerRuntime,
  createServerRuntimeWithPlatformBundle,
  createProviderRuntimeApp,
  createProviderRuntimeFromApp
});

class PlatformServerRuntimeServiceProvider {
  static id = "runtime.platform-server";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("PlatformServerRuntimeServiceProvider requires application singleton().");
    }

    app.singleton("runtime.platform-server", () => PLATFORM_SERVER_RUNTIME_API);
  }

  boot() {}
}

export { PlatformServerRuntimeServiceProvider };
