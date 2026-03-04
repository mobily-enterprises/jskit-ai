const GREETING_FACTORY = "docs.examples.02.bind.greetingFactory";

class BindExampleProvider {
  static id = "docs.examples.02.bind";

  register(app) {
    app.bind(GREETING_FACTORY, () => {
      const factoryId = `bind-${Math.random().toString(36).slice(2, 8)}`;
      return {
        factoryId,
        greet(name) {
          const normalizedName = String(name || "").trim() || "world";
          return `Hello, ${normalizedName}. [factory:${factoryId}]`;
        }
      };
    });
  }

  boot(app) {
    const firstFactory = app.make(GREETING_FACTORY);
    const secondFactory = app.make(GREETING_FACTORY);

    // Example: "Hello, alice. [factory:bind-a1b2c3]"
    const firstMessage = firstFactory.greet("alice");
    // Example: "Hello, bob. [factory:bind-d4e5f6]"
    const secondMessage = secondFactory.greet("bob");
    const distinctObjects = firstFactory !== secondFactory;
    const distinctFactoryIds = firstFactory.factoryId !== secondFactory.factoryId;

    if (!distinctObjects || !distinctFactoryIds) {
      throw new Error("BindExampleProvider expected bind() to resolve fresh objects per make().");
    }
  }
}

export { BindExampleProvider };
