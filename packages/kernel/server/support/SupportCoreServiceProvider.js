import * as normalize from "../../shared/support/normalize.js";
import * as sorting from "../../shared/support/sorting.js";
import * as tokens from "../../shared/support/tokens.js";

const SUPPORT_CORE_API = Object.freeze({
  normalize: Object.freeze({ ...normalize }),
  sorting: Object.freeze({ ...sorting }),
  tokens: Object.freeze({ ...tokens })
});

class SupportCoreServiceProvider {
  static id = "runtime.support";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("SupportCoreServiceProvider requires application singleton().");
    }

    app.singleton("runtime.support", () => SUPPORT_CORE_API);
  }

  boot() {}
}

export { SupportCoreServiceProvider };
