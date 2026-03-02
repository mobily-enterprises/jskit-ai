class AuthWebClientProvider {
  static id = "auth.web.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AuthWebClientProvider requires application singleton().");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthWebClientProvider requires application make().");
    }
  }
}

export { AuthWebClientProvider };
