import * as errors from "../../lib/errors.js";
import * as router from "../../lib/router.js";
import * as kernel from "../../lib/kernel.js";

const HTTP_FASTIFY_SERVER_API = Object.freeze({
  errors: Object.freeze({ ...errors }),
  router: Object.freeze({ ...router }),
  kernel: Object.freeze({ ...kernel })
});

class HttpFastifyServiceProvider {
  static id = "runtime.http-fastify";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("HttpFastifyServiceProvider requires application singleton().");
    }

    app.singleton("runtime.http-fastify", () => HTTP_FASTIFY_SERVER_API);
  }

  boot() {}
}

export { HttpFastifyServiceProvider };
