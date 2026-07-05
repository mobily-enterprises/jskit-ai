import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel/_testable";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";
import { AuthActionsServiceProvider } from "../src/server/providers/AuthActionsServiceProvider.js";
import { buildAuthActions } from "../src/server/actions/auth.contributor.js";

function createAppConfigFixture() {
  return {
    surfaceModeAll: "all",
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false },
      console: {
        id: "console",
        pagesRoot: "console",
        enabled: true,
        requiresAuth: true,
        requiresWorkspace: false
      }
    }
  };
}

test("auth logout action delegates to selected auth provider and notifies session changes", async () => {
  const action = buildAuthActions().find((definition) => definition.id === "auth.logout");
  const request = {
    id: "request-1"
  };
  const calls = [];

  const result = await action.execute(
    {},
    {
      requestMeta: {
        request
      }
    },
    {
      authService: {
        async logout(receivedRequest) {
          calls.push({
            type: "logout",
            request: receivedRequest
          });
          return {
            ok: true,
            clearSession: true
          };
        }
      },
      authSessionEventsService: {
        async notifySessionChanged(payload) {
          calls.push({
            type: "notify",
            context: payload.context
          });
        }
      }
    }
  );

  assert.deepEqual(result, {
    ok: true,
    clearSession: true
  });
  assert.deepEqual(calls, [
    {
      type: "logout",
      request
    },
    {
      type: "notify",
      context: {
        requestMeta: {
          request
        }
      }
    }
  ]);
});

test("AuthActionsServiceProvider registers shared auth actions against auth.provider", async () => {
  const app = createApplication();
  const logoutCalls = [];
  const published = [];
  class SelectedAuthProvider {
    static id = "auth.provider";

    register(targetApp) {
      targetApp.singleton("authService", () => ({
        async logout(request) {
          logoutCalls.push(request);
          return {
            ok: true,
            clearSession: true
          };
        },
        async authenticateRequest() {
          return {
            authenticated: false,
            actor: null,
            transientFailure: false
          };
        }
      }));
    }
  }

  app.instance("appConfig", createAppConfigFixture());
  app.instance("domainEvents", {
    async publish(payload) {
      published.push(payload);
    }
  });

  await app.start({
    providers: [ActionRuntimeServiceProvider, SelectedAuthProvider, AuthActionsServiceProvider]
  });

  const actionExecutor = app.make("actionExecutor");
  const definitions = actionExecutor.listDefinitions();
  assert.equal(definitions.some((definition) => definition.id === "auth.login.password"), true);
  assert.equal(definitions.some((definition) => definition.id === "auth.register"), true);
  assert.equal(definitions.some((definition) => definition.id === "auth.dev.loginAs"), false);
  assert.deepEqual(definitions.find((definition) => definition.id === "auth.session.read")?.surfaces, [
    "home",
    "console"
  ]);

  const request = { id: "request-2" };
  const result = await actionExecutor.execute({
    actionId: "auth.logout",
    input: {},
    context: {
      channel: "internal",
      surface: "home",
      requestMeta: { request },
      actor: { id: 42 }
    }
  });

  assert.deepEqual(result, {
    ok: true,
    clearSession: true
  });
  assert.deepEqual(logoutCalls, [request]);
  assert.equal(published.length, 2);
  assert.deepEqual(
    published.map((event) => ({
      source: event.source,
      entity: event.entity,
      operation: event.operation,
      entityId: event.entityId,
      realtimeEvent: event.meta?.realtime?.event
    })),
    [
      {
        source: "auth",
        entity: "session",
        operation: "updated",
        entityId: "42",
        realtimeEvent: "auth.session.changed"
      },
      {
        source: "users",
        entity: "bootstrap",
        operation: "updated",
        entityId: "42",
        realtimeEvent: "users.bootstrap.changed"
      }
    ]
  );
});
