import assert from "node:assert/strict";
import test from "node:test";
import { UsersCoreServiceProvider } from "../src/server/UsersCoreServiceProvider.js";
import { WorkspacesCoreServiceProvider } from "../../workspaces-core/src/server/WorkspacesCoreServiceProvider.js";

function createRegisterPhaseProbe() {
  let makeCalls = 0;

  const target = {
    singleton() {
      return proxy;
    },
    service() {
      return proxy;
    },
    actions() {
      return proxy;
    },
    instance() {
      return proxy;
    },
    tag() {
      return proxy;
    },
    has() {
      return false;
    },
    make() {
      makeCalls += 1;
      return null;
    }
  };

  const proxy = new Proxy(target, {
    get(source, property) {
      if (property === "makeCalls") {
        return makeCalls;
      }
      if (Object.prototype.hasOwnProperty.call(source, property)) {
        return source[property];
      }
      return () => proxy;
    }
  });

  return proxy;
}

test("UsersCoreServiceProvider register phase does not resolve container services eagerly", async () => {
  const app = createRegisterPhaseProbe();

  await new UsersCoreServiceProvider().register(app);

  assert.equal(app.makeCalls, 0);
});

test("WorkspacesCoreServiceProvider register phase does not resolve container services eagerly", async () => {
  const app = createRegisterPhaseProbe();

  await new WorkspacesCoreServiceProvider().register(app);

  assert.equal(app.makeCalls, 0);
});
