import * as normalize from "../../lib/normalize.js";
import * as sorting from "../../lib/sorting.js";
import * as tokens from "../../lib/tokens.js";

const SUPPORT_CORE_CLIENT_API = Object.freeze({
  normalize: Object.freeze({ ...normalize }),
  sorting: Object.freeze({ ...sorting }),
  tokens: Object.freeze({ ...tokens })
});

class SupportCoreClientProvider {
  static id = "runtime.support.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("SupportCoreClientProvider requires application singleton().");
    }

    app.singleton("runtime.support.client", () => SUPPORT_CORE_CLIENT_API);
  }

  boot() {}
}

export { SupportCoreClientProvider };
