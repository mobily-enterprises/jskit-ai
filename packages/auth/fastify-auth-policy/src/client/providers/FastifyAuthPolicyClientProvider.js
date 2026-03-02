class FastifyAuthPolicyClientProvider {
  static id = "auth.policy.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("FastifyAuthPolicyClientProvider requires application singleton().");
    }
  }

  boot() {}
}

export { FastifyAuthPolicyClientProvider };
