import { Application, createApplication, createProviderClass } from "../../shared/runtime/application.js";
import { ServiceProvider } from "../../shared/runtime/serviceProvider.js";
import * as errors from "../../shared/runtime/kernelErrors.js";

const KERNEL_CORE_API = Object.freeze({
  Application,
  createApplication,
  createProviderClass,
  ServiceProvider,
  errors: Object.freeze({ ...errors })
});

class KernelCoreServiceProvider {
  static id = "runtime.kernel";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("KernelCoreServiceProvider requires application singleton().");
    }

    app.singleton("runtime.kernel", () => KERNEL_CORE_API);
  }

  boot() {}
}

export { KernelCoreServiceProvider };
