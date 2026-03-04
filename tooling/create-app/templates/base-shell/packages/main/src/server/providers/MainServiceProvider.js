class MainServiceProvider {
  static id = "local.main";

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("MainServiceProvider requires application has().");
    }
  }

  boot() {}
}

export { MainServiceProvider };
