import * as httpClientRuntime from "../../lib/index.js";

const HTTP_CLIENT_RUNTIME_CLIENT_API = Object.freeze({
  ...httpClientRuntime
});

class HttpClientRuntimeClientProvider {
  static id = "runtime.http-client.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("HttpClientRuntimeClientProvider requires application singleton().");
    }

    app.singleton("runtime.http-client.client", () => HTTP_CLIENT_RUNTIME_CLIENT_API);
  }

  boot() {}
}

export { HttpClientRuntimeClientProvider };
