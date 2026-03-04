const APP_METADATA = "docs.examples.02.instance.appMetadata";
const COUNTER = "docs.examples.02.singleton.counter";
const MAKE_REPORT = "docs.examples.02.make.report";

class MakeExampleProvider {
  static id = "docs.examples.02.make";

  static dependsOn = ["docs.examples.02.instance", "docs.examples.02.singleton"];

  register() {}

  boot(app) {
    const metadata = app.make(APP_METADATA);
    const counter = app.make(COUNTER);

    const before = counter.current();
    const after = counter.increment();

    app.instance(MAKE_REPORT, {
      module: metadata.module,
      counterBefore: before,
      counterAfter: after
    });
  }
}

export { MakeExampleProvider };
