import assert from "node:assert/strict";
import test from "node:test";
import { definePlacement } from "../src/client/placement/validators.js";
import { createWebPlacementRuntime } from "../src/client/placement/runtime.js";

function createAppStub({ tokens = {}, contextContributors = [] } = {}) {
  return {
    has(token) {
      return Object.prototype.hasOwnProperty.call(tokens, token);
    },
    make(token) {
      if (!this.has(token)) {
        throw new Error(`Unknown token: ${String(token)}`);
      }
      return tokens[token];
    },
    resolveTag(tagName) {
      if (tagName === "web-placement.context.client") {
        return contextContributors;
      }
      return [];
    }
  };
}

function createPlacementContext() {
  return {
    surfaceConfig: {
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app", "admin", "console"]
    }
  };
}

test("web placement runtime filters by surface/host/position, resolves component tokens, and sorts by order", () => {
  const app = createAppStub({
    tokens: {
      "component.alerts": () => null,
      "component.profile": () => null,
      "component.menu": () => null
    }
  });

  const runtime = createWebPlacementRuntime({ app });
  runtime.replacePlacements([
    definePlacement({
      id: "test.menu",
      target: "shell-layout:primary-menu",
      surfaces: ["app"],
      order: 30,
      componentToken: "component.menu"
    }),
    definePlacement({
      id: "test.profile",
      target: "shell-layout:top-right",
      surfaces: ["*"],
      order: 20,
      componentToken: "component.profile"
    }),
    definePlacement({
      id: "test.alerts",
      target: "shell-layout:top-right",
      surfaces: ["app"],
      order: 10,
      componentToken: "component.alerts"
    })
  ]);
  runtime.setContext(createPlacementContext());

  const topRight = runtime.getPlacements({ surface: "app", target: "shell-layout:top-right" });
  assert.deepEqual(topRight.map((entry) => entry.id), ["test.alerts", "test.profile"]);
  assert.equal(typeof topRight[0].component, "function");

  const primaryMenu = runtime.getPlacements({ surface: "app", target: "shell-layout:primary-menu" });
  assert.deepEqual(primaryMenu.map((entry) => entry.id), ["test.menu"]);

  const adminTopRight = runtime.getPlacements({ surface: "admin", target: "shell-layout:top-right" });
  assert.deepEqual(adminTopRight.map((entry) => entry.id), ["test.profile"]);
});

test("web placement runtime applies context contributors and placement when() predicates", () => {
  const app = createAppStub({
    tokens: {
      "component.guest": () => null,
      "component.authenticated": () => null
    },
    contextContributors: [
      () => ({
        auth: { authenticated: true }
      })
    ]
  });

  const runtime = createWebPlacementRuntime({ app });
  runtime.replacePlacements([
    definePlacement({
      id: "guest.item",
      target: "auth-profile-menu:primary-menu",
      surfaces: ["*"],
      componentToken: "component.guest",
      when: ({ auth }) => !Boolean(auth?.authenticated)
    }),
    definePlacement({
      id: "auth.item",
      target: "auth-profile-menu:primary-menu",
      surfaces: ["*"],
      componentToken: "component.authenticated",
      when: ({ auth }) => Boolean(auth?.authenticated)
    })
  ]);

  const menu = runtime.getPlacements({ surface: "app", target: "auth-profile-menu:primary-menu" });
  assert.deepEqual(menu.map((entry) => entry.id), ["auth.item"]);
});

test("web placement runtime uses runtime context and local context overrides contributor values", () => {
  const app = createAppStub({
    tokens: {
      "component.allowed": () => null
    },
    contextContributors: [
      () => ({
        auth: {
          authenticated: false
        }
      })
    ]
  });

  const runtime = createWebPlacementRuntime({ app });
  runtime.replacePlacements([
    definePlacement({
      id: "allowed",
      target: "auth-profile-menu:primary-menu",
      surfaces: ["*"],
      componentToken: "component.allowed",
      when: ({ auth }) => Boolean(auth?.authenticated)
    })
  ]);

  runtime.setContext({
    auth: {
      authenticated: true
    }
  });
  const fromRuntime = runtime.getPlacements({ surface: "app", target: "auth-profile-menu:primary-menu" });
  assert.deepEqual(fromRuntime.map((entry) => entry.id), ["allowed"]);

  const fromLocalOverride = runtime.getPlacements({
    surface: "app",
    target: "auth-profile-menu:primary-menu",
    context: {
      auth: {
        authenticated: false
      }
    }
  });
  assert.deepEqual(fromLocalOverride.map((entry) => entry.id), []);
});

test("web placement runtime notifies subscribers on placement and context updates", () => {
  const app = createAppStub();
  const runtime = createWebPlacementRuntime({ app });
  const events = [];
  const unsubscribe = runtime.subscribe((event) => {
    events.push(event.type);
  });

  runtime.replacePlacements([]);
  runtime.setContext({
    auth: {
      authenticated: true
    }
  });

  unsubscribe();
  runtime.setContext({
    auth: {
      authenticated: false
    }
  });

  assert.deepEqual(events, ["placements.replaced", "context.updated"]);
});

test("web placement runtime rejects duplicate placement ids", () => {
  const app = createAppStub();
  const runtime = createWebPlacementRuntime({ app });

  assert.throws(() => {
    runtime.replacePlacements([
      definePlacement({
        id: "dup.entry",
        target: "shell-layout:top-right",
        surfaces: ["*"],
        componentToken: "component.a"
      }),
      definePlacement({
        id: "dup.entry",
        target: "shell-layout:primary-menu",
        surfaces: ["*"],
        componentToken: "component.b"
      })
    ]);
  }, /Duplicate placement id/);
});

test("web placement runtime skips throwing component tokens and logs resolution errors once", () => {
  const app = {
    has(token) {
      return token === "component.bad" || token === "component.good";
    },
    make(token) {
      if (token === "component.bad") {
        throw new Error("bad component token");
      }
      if (token === "component.good") {
        return () => null;
      }
      throw new Error(`Unknown token: ${String(token)}`);
    },
    resolveTag() {
      return [];
    }
  };

  const errors = [];
  const runtime = createWebPlacementRuntime({
    app,
    logger: {
      warn() {},
      error(payload, message) {
        errors.push({ payload, message });
      }
    }
  });

  runtime.replacePlacements([
    definePlacement({
      id: "bad",
      target: "shell-layout:top-right",
      surfaces: ["*"],
      componentToken: "component.bad"
    }),
    definePlacement({
      id: "good",
      target: "shell-layout:top-right",
      surfaces: ["*"],
      componentToken: "component.good"
    })
  ]);

  const first = runtime.getPlacements({ surface: "app", target: "shell-layout:top-right" });
  assert.deepEqual(first.map((entry) => entry.id), ["good"]);
  assert.equal(errors.length, 1);

  const second = runtime.getPlacements({ surface: "app", target: "shell-layout:top-right" });
  assert.deepEqual(second.map((entry) => entry.id), ["good"]);
  assert.equal(errors.length, 1);
});

test("web placement runtime clears failed token cache when placements are replaced", () => {
  let shouldThrow = true;
  const app = {
    has(token) {
      return token === "component.toggle";
    },
    make(token) {
      if (token !== "component.toggle") {
        throw new Error(`Unknown token: ${String(token)}`);
      }
      if (shouldThrow) {
        throw new Error("toggle failure");
      }
      return () => null;
    },
    resolveTag() {
      return [];
    }
  };

  const runtime = createWebPlacementRuntime({
    app,
    logger: {
      warn() {},
      error() {}
    }
  });

  runtime.replacePlacements([
    definePlacement({
      id: "toggle",
      target: "shell-layout:top-right",
      surfaces: ["*"],
      componentToken: "component.toggle"
    })
  ]);

  const initial = runtime.getPlacements({ surface: "app", target: "shell-layout:top-right" });
  assert.equal(initial.length, 0);

  shouldThrow = false;
  const stillSkipped = runtime.getPlacements({ surface: "app", target: "shell-layout:top-right" });
  assert.equal(stillSkipped.length, 0);

  runtime.replacePlacements([
    definePlacement({
      id: "toggle",
      target: "shell-layout:top-right",
      surfaces: ["*"],
      componentToken: "component.toggle"
    })
  ]);

  const recovered = runtime.getPlacements({ surface: "app", target: "shell-layout:top-right" });
  assert.equal(recovered.length, 1);
});

test("web placement runtime follows explicit surface targeting without role indirection", () => {
  const app = createAppStub({
    tokens: {
      "component.global": () => null,
      "component.app": () => null,
      "component.admin": () => null
    }
  });
  const runtime = createWebPlacementRuntime({ app });
  runtime.replacePlacements([
    definePlacement({
      id: "global.banner",
      target: "shell-layout:top-right",
      surfaces: ["*"],
      order: 10,
      componentToken: "component.global"
    }),
    definePlacement({
      id: "app.link",
      target: "shell-layout:top-right",
      surfaces: ["app"],
      order: 20,
      componentToken: "component.app"
    }),
    definePlacement({
      id: "admin.link",
      target: "shell-layout:top-right",
      surfaces: ["admin"],
      order: 30,
      componentToken: "component.admin"
    })
  ]);
  runtime.setContext(createPlacementContext());

  const appEntries = runtime.getPlacements({ surface: "app", target: "shell-layout:top-right" });
  assert.deepEqual(appEntries.map((placement) => placement.id), ["global.banner", "app.link"]);

  const adminEntries = runtime.getPlacements({ surface: "admin", target: "shell-layout:top-right" });
  assert.deepEqual(adminEntries.map((placement) => placement.id), ["global.banner", "admin.link"]);
});
