import * as rbac from "../lib/rbac.js";

class RbacServiceProvider {
  static id = "auth.rbac";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("RbacServiceProvider requires application singleton().");
    }

    app.singleton("auth.rbac", () => Object.freeze(rbac));
  }

  boot() {}
}

export { RbacServiceProvider };
