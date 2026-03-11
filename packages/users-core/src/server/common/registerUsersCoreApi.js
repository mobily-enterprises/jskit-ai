function registerUsersCoreApi(app, usersCoreApi) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerUsersCoreApi requires application singleton().");
  }

  app.singleton("users.core", () => usersCoreApi);
}

export { registerUsersCoreApi };
