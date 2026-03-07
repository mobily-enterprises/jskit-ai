import * as httpClientRuntime from "../../shared/clientRuntime/index.js";

const HTTP_CLIENT_RUNTIME_API = Object.freeze({
  ...httpClientRuntime
});

class HttpClientRuntimeServiceProvider {
  static id = "runtime.http-client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("HttpClientRuntimeServiceProvider requires application singleton().");
    }

    app.singleton("runtime.http-client", () => HTTP_CLIENT_RUNTIME_API);
  }

  boot() {}
}

export { HttpClientRuntimeServiceProvider };
