import assert from "node:assert/strict";
import test from "node:test";
import { definePlacement } from "../src/client/placement/contracts.js";
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

test("web placement runtime filters by surface/slot, resolves component tokens, and sorts by order", () => {
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
      surface: "app",
      slot: "app.primary-menu",
      order: 30,
      componentToken: "component.menu"
    }),
    definePlacement({
      id: "test.profile",
      surface: "*",
      slot: "app.top-right",
      order: 20,
      componentToken: "component.profile"
    }),
    definePlacement({
      id: "test.alerts",
      surface: "app",
      slot: "app.top-right",
      order: 10,
      componentToken: "component.alerts"
    })
  ]);

  const topRight = runtime.getPlacements({ surface: "app", slot: "app.top-right" });
  assert.deepEqual(topRight.map((entry) => entry.id), ["test.alerts", "test.profile"]);
  assert.equal(typeof topRight[0].component, "function");

  const primaryMenu = runtime.getPlacements({ surface: "app", slot: "app.primary-menu" });
  assert.deepEqual(primaryMenu.map((entry) => entry.id), ["test.menu"]);

  const adminTopRight = runtime.getPlacements({ surface: "admin", slot: "app.top-right" });
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
      slot: "avatar.primary-menu",
      surface: "*",
      componentToken: "component.guest",
      when: ({ auth }) => !Boolean(auth?.authenticated)
    }),
    definePlacement({
      id: "auth.item",
      slot: "avatar.primary-menu",
      surface: "*",
      componentToken: "component.authenticated",
      when: ({ auth }) => Boolean(auth?.authenticated)
    })
  ]);

  const menu = runtime.getPlacements({ surface: "app", slot: "avatar.primary-menu" });
  assert.deepEqual(menu.map((entry) => entry.id), ["auth.item"]);
});

test("web placement runtime rejects duplicate placement ids", () => {
  const app = createAppStub();
  const runtime = createWebPlacementRuntime({ app });

  assert.throws(() => {
    runtime.replacePlacements([
      definePlacement({
        id: "dup.entry",
        slot: "app.top-right",
        componentToken: "component.a"
      }),
      definePlacement({
        id: "dup.entry",
        slot: "app.primary-menu",
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
      slot: "app.top-right",
      componentToken: "component.bad"
    }),
    definePlacement({
      id: "good",
      slot: "app.top-right",
      componentToken: "component.good"
    })
  ]);

  const first = runtime.getPlacements({ surface: "app", slot: "app.top-right" });
  assert.deepEqual(first.map((entry) => entry.id), ["good"]);
  assert.equal(errors.length, 1);

  const second = runtime.getPlacements({ surface: "app", slot: "app.top-right" });
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
      slot: "app.top-right",
      componentToken: "component.toggle"
    })
  ]);

  const initial = runtime.getPlacements({ surface: "app", slot: "app.top-right" });
  assert.equal(initial.length, 0);

  shouldThrow = false;
  const stillSkipped = runtime.getPlacements({ surface: "app", slot: "app.top-right" });
  assert.equal(stillSkipped.length, 0);

  runtime.replacePlacements([
    definePlacement({
      id: "toggle",
      slot: "app.top-right",
      componentToken: "component.toggle"
    })
  ]);

  const recovered = runtime.getPlacements({ surface: "app", slot: "app.top-right" });
  assert.equal(recovered.length, 1);
});
