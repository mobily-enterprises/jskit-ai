import assert from "node:assert/strict";
import test from "node:test";
import { UsersCoreServiceProvider } from "../src/server/UsersCoreServiceProvider.js";
import { INTERNAL_JSON_REST_API } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { createRouter } from "../../kernel/server/http/lib/router.js";

function createReplyDouble() {
  return {
    statusCode: 200,
    payload: null,
    redirectedTo: "",
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    },
    redirect(value) {
      this.redirectedTo = String(value || "");
      return this;
    }
  };
}

function findRoute(routes, { method, path }) {
  return routes.find((route) => route.method === method && route.path === path) || null;
}

async function registerRoutes({
  authService = {}
} = {}) {
  const router = createRouter();
  const internalApi = {
    resources: {},
    async addResource(scopeName) {
      this.resources[scopeName] = {};
    }
  };

  const bindings = new Map([
    ["jskit.http.router", router],
    ["authService", authService],
    [INTERNAL_JSON_REST_API, internalApi],
    [
      "users.accountProfile.service",
      {
        async readAvatar() {
          return {
            mimeType: "image/png",
            buffer: Buffer.from([])
          };
        }
      }
    ],
    ["actionExecutor", {}]
  ]);

  const app = {
    has(token) {
      return bindings.has(token);
    },
    instance(token, value) {
      bindings.set(token, value);
      return this;
    },
    make(token) {
      if (!bindings.has(token)) {
        throw new Error(`Missing test binding for token: ${String(token)}`);
      }
      return bindings.get(token);
    }
  };

  const provider = new UsersCoreServiceProvider();
  await provider.boot(app);

  return router.list();
}

function createActionRequest({ input = {}, executeAction, file = null }) {
  return {
    input,
    executeAction,
    file,
    user: {
      id: 42
    }
  };
}

test("users-core boot mounts account routes without workspace routes", async () => {
  const routes = await registerRoutes();
  const settingsRoute = findRoute(routes, { method: "GET", path: "/api/settings" });
  const profileRoute = findRoute(routes, { method: "PATCH", path: "/api/settings/profile" });
  const preferencesRoute = findRoute(routes, { method: "PATCH", path: "/api/settings/preferences" });
  const notificationsRoute = findRoute(routes, { method: "PATCH", path: "/api/settings/notifications" });

  assert.equal(settingsRoute?.path, "/api/settings");
  assert.equal(profileRoute?.path, "/api/settings/profile");
  assert.equal(preferencesRoute?.path, "/api/settings/preferences");
  assert.equal(notificationsRoute?.path, "/api/settings/notifications");
  assert.equal(settingsRoute?.transport?.kind, "jsonapi-resource");
  assert.equal(profileRoute?.transport?.kind, "jsonapi-resource");
  assert.equal(preferencesRoute?.transport?.kind, "jsonapi-resource");
  assert.equal(notificationsRoute?.transport?.kind, "jsonapi-resource");
  assert.equal(settingsRoute?.schema?.response?.[200]?.required?.[0], "data");
  assert.equal(profileRoute?.schema?.body?.required?.[0], "data");
  assert.equal(profileRoute?.schema?.response?.[200]?.required?.[0], "data");
  assert.equal(
    profileRoute?.schema?.body?.definitions?.["user-profilesRequestResource"]?.properties?.type?.const,
    "user-profiles"
  );
  assert.equal(
    settingsRoute?.schema?.response?.[200]?.definitions?.["user-settingsSuccessResource"]?.properties?.type?.const,
    "user-settings"
  );
  assert.equal(
    typeof findRoute(routes, { method: "GET", path: "/api/settings/security/oauth/:provider/start" })?.schema?.response?.[302],
    "object"
  );
  assert.equal(findRoute(routes, { method: "GET", path: "/api/workspaces" }), null);
  assert.equal(findRoute(routes, { method: "GET", path: "/api/w/:workspaceSlug/settings" }), null);
});

test("account route handlers build action input from request.input", async () => {
  const routes = await registerRoutes({
    authService: {
      writeSessionCookies() {}
    }
  });
  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    if (payload.actionId === "settings.security.oauth.link.start") {
      return { url: "/oauth/link" };
    }
    if (payload.actionId === "settings.profile.update") {
      return { response: { __jskitJsonApiResult: true, kind: "data", value: {} }, session: null };
    }
    if (payload.actionId === "settings.security.password.change") {
      return { response: { __jskitJsonApiResult: true, kind: "meta", value: { message: "ok" } }, session: null };
    }
    return {};
  };

  await findRoute(routes, { method: "PATCH", path: "/api/settings/profile" }).handler(
    createActionRequest({
      input: { body: { displayName: "Merc" } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "PATCH", path: "/api/settings/preferences" }).handler(
    createActionRequest({
      input: { body: { locale: "en-US" } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "PATCH", path: "/api/settings/notifications" }).handler(
    createActionRequest({
      input: { body: { email: true } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "POST", path: "/api/settings/security/change-password" }).handler(
    createActionRequest({
      input: {
        body: {
          currentPassword: "old-password",
          newPassword: "new-password-123",
          confirmPassword: "new-password-123"
        }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "PATCH", path: "/api/settings/security/methods/password" }).handler(
    createActionRequest({
      input: { body: { enabled: true } },
      executeAction
    }),
    createReplyDouble()
  );
  const oauthReply = createReplyDouble();
  await findRoute(routes, { method: "GET", path: "/api/settings/security/oauth/:provider/start" }).handler(
    createActionRequest({
      input: {
        params: { provider: "github" },
        query: { returnTo: "/app/settings" }
      },
      executeAction
    }),
    oauthReply
  );
  await findRoute(routes, { method: "DELETE", path: "/api/settings/security/oauth/:provider" }).handler(
    createActionRequest({
      input: { params: { provider: "github" } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "POST", path: "/api/settings/security/logout-others" }).handler(
    createActionRequest({
      executeAction
    }),
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, { displayName: "Merc" });
  assert.deepEqual(calls[1].input, { locale: "en-US" });
  assert.deepEqual(calls[2].input, { email: true });
  assert.deepEqual(calls[3].input, {
    currentPassword: "old-password",
    newPassword: "new-password-123",
    confirmPassword: "new-password-123"
  });
  assert.deepEqual(calls[4].input, { enabled: true });
  assert.deepEqual(calls[5].input, { provider: "github", returnTo: "/app/settings" });
  assert.equal(oauthReply.redirectedTo, "/oauth/link");
  assert.deepEqual(calls[6].input, { provider: "github" });
  assert.equal(calls[7].actionId, "settings.security.sessions.logout_others");
});

test("account settings jsonapi transport resolves response resource id from request user", async () => {
  const routes = await registerRoutes();
  const settingsRoute = findRoute(routes, { method: "GET", path: "/api/settings" });

  const document = settingsRoute.transport.response(
    {
      __jskitJsonApiResult: true,
      kind: "data",
      value: {
        profile: {
          displayName: "Merc"
        },
        security: {},
        preferences: {},
        notifications: {}
      }
    },
    {
      request: {
        user: {
          id: 42
        }
      },
      statusCode: 200
    }
  );

  assert.deepEqual(document, {
    data: {
      type: "user-settings",
      id: "42",
      attributes: {
        profile: {
          displayName: "Merc"
        },
        security: {},
        preferences: {},
        notifications: {}
      }
    }
  });
});
