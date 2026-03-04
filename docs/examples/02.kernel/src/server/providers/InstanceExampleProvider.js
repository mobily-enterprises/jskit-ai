const APP_METADATA = "docs.examples.02.instance.appMetadata";
const INSTANCE_REPORT = "docs.examples.02.instance.report";
const GREETING_FACTORY = "docs.examples.02.bind.greetingFactory";
const BIND_REPORT = "docs.examples.02.bind.report";

class InstanceExampleProvider {
  static id = "docs.examples.02.instance";
  static dependsOn = ["docs.examples.02.bind"];

  register(app) {
    app.instance(
      APP_METADATA,
      Object.freeze({
        module: "02.kernel",
        environment: "docs-example",
        featureFlags: Object.freeze({
          auditEnabled: true,
          tracingEnabled: false
        })
      })
    );
  }

  boot(app) {
    const firstResolve = app.make(APP_METADATA);
    const secondResolve = app.make(APP_METADATA);

    app.instance(INSTANCE_REPORT, {
      sameReference: firstResolve === secondResolve,
      module: firstResolve.module,
      auditEnabled: firstResolve.featureFlags.auditEnabled
    });

    const firstFactory = app.make(GREETING_FACTORY);
    const secondFactory = app.make(GREETING_FACTORY);

    app.instance(BIND_REPORT, {
      // Example: "Hello, alice. [factory:bind-a1b2c3]"
      firstMessage: firstFactory.greet("alice"),
      // Example: "Hello, bob. [factory:bind-d4e5f6]"
      secondMessage: secondFactory.greet("bob"),
      distinctObjects: firstFactory !== secondFactory,
      distinctFactoryIds: firstFactory.factoryId !== secondFactory.factoryId
    });
  }
}

export { InstanceExampleProvider };
