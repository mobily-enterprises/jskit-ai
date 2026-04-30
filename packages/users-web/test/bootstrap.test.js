import assert from "node:assert/strict";
import test from "node:test";
import { resolveBootstrapPayloadHandlers } from "@jskit-ai/shell-web/client/bootstrap";
import { resolvePlacementUserFromBootstrapPayload } from "../src/client/lib/bootstrap.js";
import {
  createUsersBootstrapUserHandler,
  registerUsersBootstrapPayloadHandlers
} from "../src/client/bootstrap/user-bootstrap-handler.js";

test("resolvePlacementUserFromBootstrapPayload returns null for anonymous sessions", () => {
  assert.equal(
    resolvePlacementUserFromBootstrapPayload({
      session: {
        authenticated: false
      }
    }),
    null
  );
});

test("resolvePlacementUserFromBootstrapPayload maps profile fields used by placement avatar widget", () => {
  const user = resolvePlacementUserFromBootstrapPayload({
    session: {
      authenticated: true,
      userId: "42"
    },
    profile: {
      displayName: "Ada Lovelace",
      email: "ADA@EXAMPLE.COM",
      avatar: {
        effectiveUrl: "https://cdn.example.com/ada.png"
      }
    }
  });

  assert.deepEqual(user, {
    id: "42",
    displayName: "Ada Lovelace",
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarUrl: "https://cdn.example.com/ada.png"
  });
});

function createPlacementRuntimeDouble() {
  return {
    context: Object.freeze({}),
    getContext() {
      return this.context;
    },
    setContext(patch = {}, { replace = false } = {}) {
      this.context = Object.freeze(
        replace
          ? { ...patch }
          : {
              ...this.context,
              ...patch
            }
      );
      return this.context;
    }
  };
}

function createBootstrapRegistryAppDouble() {
  const singletons = new Map();
  const instances = new Map();
  const tags = new Map();

  return {
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    tag(token, tagName) {
      const current = tags.get(tagName) || [];
      current.push(token);
      tags.set(tagName, current);
    },
    resolveTag(tagName) {
      return (tags.get(tagName) || []).map((token) => this.make(token));
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      const factory = singletons.get(token);
      if (typeof factory !== "function") {
        throw new Error(`Unknown token ${String(token)}`);
      }
      const instance = factory(this);
      instances.set(token, instance);
      return instance;
    }
  };
}

test("users web bootstrap user handler writes placement user", async () => {
  const handler = createUsersBootstrapUserHandler();
  const placementRuntime = createPlacementRuntimeDouble();
  await handler.applyBootstrapPayload({
    payload: {
      session: {
        authenticated: true,
        userId: "42"
      },
      profile: {
        displayName: "Ada Lovelace",
        email: "ADA@EXAMPLE.COM",
        avatar: {
          effectiveUrl: "https://cdn.example.com/ada.png"
        }
      }
    },
    placementRuntime,
    source: "test"
  });

  assert.deepEqual(placementRuntime.getContext().user, {
    id: "42",
    displayName: "Ada Lovelace",
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarUrl: "https://cdn.example.com/ada.png"
  });
});

test("users web bootstrap user handler clears placement user on bootstrap 401 only", async () => {
  const handler = createUsersBootstrapUserHandler();
  const placementRuntime = createPlacementRuntimeDouble();
  placementRuntime.setContext({
    user: {
      id: "42",
      displayName: "Ada Lovelace"
    }
  });

  await handler.handleBootstrapError({
    error: {
      statusCode: 404
    },
    placementRuntime,
    source: "test"
  });
  assert.deepEqual(placementRuntime.getContext().user, {
    id: "42",
    displayName: "Ada Lovelace"
  });

  await handler.handleBootstrapError({
    error: {
      statusCode: 401
    },
    placementRuntime,
    source: "test"
  });
  assert.equal(placementRuntime.getContext().user, null);
});

test("registerUsersBootstrapPayloadHandlers registers the users bootstrap user handler", () => {
  const app = createBootstrapRegistryAppDouble();
  registerUsersBootstrapPayloadHandlers(app);

  const handlers = resolveBootstrapPayloadHandlers(app);
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0]?.handlerId, "users.web.bootstrap.user");
  assert.equal(typeof handlers[0]?.applyBootstrapPayload, "function");
  assert.equal(typeof handlers[0]?.handleBootstrapError, "function");
});
