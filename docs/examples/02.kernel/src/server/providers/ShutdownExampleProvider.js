const RESOURCE = "docs.examples.02.shutdown.resource";
const SHUTDOWN_REPORT = "docs.examples.02.shutdown.report";

class ShutdownExampleProvider {
  static id = "docs.examples.02.shutdown";

  register(app) {
    app.singleton(RESOURCE, () => {
      const state = {
        startedAt: new Date().toISOString(),
        closedAt: null
      };

      return {
        state,
        close() {
          state.closedAt = new Date().toISOString();
        }
      };
    });
  }

  boot(app) {
    const resource = app.make(RESOURCE);
    app.instance(SHUTDOWN_REPORT, {
      startedAt: resource.state.startedAt,
      closedAt: resource.state.closedAt
    });
  }

  shutdown(app) {
    if (!app.has(RESOURCE)) {
      return;
    }

    const resource = app.make(RESOURCE);
    resource.close();
  }
}

export { ShutdownExampleProvider };
