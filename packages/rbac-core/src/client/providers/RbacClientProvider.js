class RbacClientProvider {
  static id = "auth.rbac.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("RbacClientProvider requires application singleton().");
    }
  }

  boot() {}
}

export { RbacClientProvider };
