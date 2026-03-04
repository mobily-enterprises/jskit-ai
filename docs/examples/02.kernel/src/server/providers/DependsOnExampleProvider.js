import { DEPENDS_ON_RECORDER, DEPENDS_ON_REPORT } from "./DependsOnTokens.js";

class DependsOnExampleProvider {
  static id = "docs.examples.02.dependsOn";

  static dependsOn = ["docs.examples.02.dependsOn.base"];

  register(app) {
    app.make(DEPENDS_ON_RECORDER).record("dependsOn.register");
  }

  boot(app) {
    const recorder = app.make(DEPENDS_ON_RECORDER);
    recorder.record("dependsOn.boot");

    app.instance(DEPENDS_ON_REPORT, {
      dependsOn: [...DependsOnExampleProvider.dependsOn],
      observedOrder: recorder.list()
    });
  }
}

export { DependsOnExampleProvider };
