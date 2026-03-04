import { DEPENDS_ON_RECORDER, DEPENDS_ON_SEQUENCE } from "./DependsOnTokens.js";

class DependsOnBaseExampleProvider {
  static id = "docs.examples.02.dependsOn.base";

  register(app) {
    app.instance(DEPENDS_ON_SEQUENCE, []);

    app.singleton(DEPENDS_ON_RECORDER, (scope) => ({
      record(step) {
        const sequence = scope.make(DEPENDS_ON_SEQUENCE);
        sequence.push(step);
      },
      list() {
        return [...scope.make(DEPENDS_ON_SEQUENCE)];
      }
    }));

    app.make(DEPENDS_ON_RECORDER).record("base.register");
  }

  boot(app) {
    app.make(DEPENDS_ON_RECORDER).record("base.boot");
  }
}

export { DependsOnBaseExampleProvider };
