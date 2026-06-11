import assert from "node:assert/strict";
import test from "node:test";

import { registerRoutes } from "../src/server/registerRoutes.js";

function createReplyDouble() {
  return {
    statusCode: 200,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    }
  };
}

function findRoute(routes, { method, path }) {
  return routes.find((route) => route.method === method && route.path === path) || null;
}

function mountRoutes() {
  const registeredRoutes = [];
  const router = {
    register(method, path, route, handler) {
      registeredRoutes.push({
        ...route,
        method,
        path,
        handler
      });
    }
  };

  const app = {
    make(token) {
      if (token !== "jskit.http.router") {
        throw new Error(`Unexpected token: ${String(token)}`);
      }
      return router;
    }
  };

  registerRoutes(app);
  return registeredRoutes;
}

function createActionRequest({ input = {}, executeAction }) {
  return {
    input,
    executeAction
  };
}

test("google rewarded workflow routes mount with explicit request and response contracts", () => {
  const routes = mountRoutes();
  const currentRoute = findRoute(routes, {
    method: "GET",
    path: "/api/w/:workspaceSlug/google-rewarded/current"
  });
  const startRoute = findRoute(routes, {
    method: "POST",
    path: "/api/w/:workspaceSlug/google-rewarded/start"
  });
  const grantRoute = findRoute(routes, {
    method: "POST",
    path: "/api/w/:workspaceSlug/google-rewarded/grant"
  });
  const closeRoute = findRoute(routes, {
    method: "POST",
    path: "/api/w/:workspaceSlug/google-rewarded/close"
  });

  assert.equal(currentRoute?.auth, "required");
  assert.equal(currentRoute?.visibility, "workspace_user");
  assert.equal(currentRoute?.surface, "app");
  assert.equal(typeof currentRoute?.query?.schema, "object");
  assert.equal(currentRoute?.responses?.[200]?.transportSchema?.properties?.blocked?.["x-json-rest-schema"]?.castType, "boolean");

  assert.equal(startRoute?.auth, "required");
  assert.equal(startRoute?.visibility, "workspace_user");
  assert.equal(typeof startRoute?.body?.schema, "object");
  assert.equal(startRoute?.responses?.[200]?.transportSchema?.properties?.session?.anyOf?.[1]?.type, "null");

  assert.equal(grantRoute?.responses?.[200]?.transportSchema?.properties?.unlocked?.["x-json-rest-schema"]?.castType, "boolean");
  assert.equal(closeRoute?.responses?.[200]?.transportSchema?.properties?.closed?.["x-json-rest-schema"]?.castType, "boolean");
});

test("google rewarded workflow route handlers build action input from request.input", async () => {
  const routes = mountRoutes();
  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    if (payload.actionId === "google-rewarded.current.read") {
      return {
        gateKey: "progress-logging",
        workspaceSlug: "alpha",
        surface: "app",
        enabled: true,
        available: true,
        blocked: true,
        reason: "reward-required",
        rule: null,
        providerConfig: null,
        unlock: null,
        cooldownUntil: null,
        dailyLimitRemaining: null
      };
    }
    if (payload.actionId === "google-rewarded.start") {
      return {
        gateKey: "progress-logging",
        workspaceSlug: "alpha",
        surface: "app",
        enabled: true,
        available: true,
        blocked: true,
        reason: "reward-required",
        rule: null,
        providerConfig: null,
        unlock: null,
        cooldownUntil: null,
        dailyLimitRemaining: null,
        session: null
      };
    }
    if (payload.actionId === "google-rewarded.grant") {
      return {
        unlocked: true,
        workspaceSlug: "alpha",
        gateKey: "progress-logging",
        unlock: null,
        session: null
      };
    }
    return {
      closed: true,
      workspaceSlug: "alpha",
      gateKey: "progress-logging",
      session: null,
      reason: null
    };
  };

  await findRoute(routes, {
    method: "GET",
    path: "/api/w/:workspaceSlug/google-rewarded/current"
  }).handler(
    createActionRequest({
      input: {
        params: {
          workspaceSlug: "Alpha"
        },
        query: {
          gateKey: "progress-logging"
        }
      },
      executeAction
    }),
    createReplyDouble()
  );

  await findRoute(routes, {
    method: "POST",
    path: "/api/w/:workspaceSlug/google-rewarded/start"
  }).handler(
    createActionRequest({
      input: {
        params: {
          workspaceSlug: "Alpha"
        },
        body: {
          gateKey: "progress-logging"
        }
      },
      executeAction
    }),
    createReplyDouble()
  );

  await findRoute(routes, {
    method: "POST",
    path: "/api/w/:workspaceSlug/google-rewarded/grant"
  }).handler(
    createActionRequest({
      input: {
        params: {
          workspaceSlug: "Alpha"
        },
        body: {
          sessionId: "41"
        }
      },
      executeAction
    }),
    createReplyDouble()
  );

  await findRoute(routes, {
    method: "POST",
    path: "/api/w/:workspaceSlug/google-rewarded/close"
  }).handler(
    createActionRequest({
      input: {
        params: {
          workspaceSlug: "Alpha"
        },
        body: {
          sessionId: "41"
        }
      },
      executeAction
    }),
    createReplyDouble()
  );

  assert.deepEqual(calls[0], {
    actionId: "google-rewarded.current.read",
    input: {
      workspaceSlug: "alpha",
      gateKey: "progress-logging"
    }
  });
  assert.deepEqual(calls[1], {
    actionId: "google-rewarded.start",
    input: {
      workspaceSlug: "alpha",
      gateKey: "progress-logging"
    }
  });
  assert.deepEqual(calls[2], {
    actionId: "google-rewarded.grant",
    input: {
      workspaceSlug: "alpha",
      sessionId: "41"
    }
  });
  assert.deepEqual(calls[3], {
    actionId: "google-rewarded.close",
    input: {
      workspaceSlug: "alpha",
      sessionId: "41"
    }
  });
});
