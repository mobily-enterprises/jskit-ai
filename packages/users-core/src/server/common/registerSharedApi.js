function registerSharedApi(app, usersCoreApi) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerSharedApi requires application singleton().");
  }

  app.singleton("users.core", () => usersCoreApi);
}

export { registerSharedApi };
