class MainServiceProvider {
  static id = "local.main";

  // Optional: register container bindings here (services/singletons).
  register() {}

  // Start backend features here:
  // 1) define shared contracts in `src/shared/schemas`
  // 2) resolve router with `app.make(TOKENS.HttpRouter)`
  // 3) register routes and handlers
  // 4) extract to services/controllers/routes as the feature grows
  boot() {}
}

export { MainServiceProvider };
