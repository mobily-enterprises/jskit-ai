import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel-core";
import { createHttpRuntime } from "@jskit-ai/http-fastify-core/kernel";
import { WorkspaceRouteServiceProvider } from "../src/server/providers/WorkspaceRouteServiceProvider.js";

function createFastifyStub() {
  const routes = [];
  return {
    routes,
    route(definition) {
      routes.push(definition);
    }
  };
}

function createReplyStub() {
  return {
    sent: false,
    statusCode: null,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      this.sent = true;
      return this;
    }
  };
}

test("workspace route provider registers routes and handles listWorkspaces", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();
  const httpRuntime = createHttpRuntime({ app, fastify });

  app.instance("authService", {
    getOAuthProviderCatalog() {
      return { providers: [], defaultProvider: "" };
    },
    clearSessionCookies() {},
    writeSessionCookies() {}
  });

  app.instance("consoleService", {
    async ensureInitialConsoleMember() {
      return null;
    }
  });

  app.instance("actionExecutor", {
    async execute({ actionId }) {
      if (actionId === "workspace.workspaces.list") {
        return {
          workspaces: [{ id: 1, slug: "main" }]
        };
      }
      return {};
    }
  });

  await app.start({ providers: [WorkspaceRouteServiceProvider] });

  const registration = httpRuntime.registerRoutes();
  assert.equal(registration.routeCount > 0, true);

  const listWorkspacesRoute = fastify.routes.find(
    (route) => route.method === "GET" && route.url === "/api/workspaces"
  );
  assert.ok(listWorkspacesRoute);

  const reply = createReplyStub();
  await listWorkspacesRoute.handler({}, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    workspaces: [{ id: 1, slug: "main" }]
  });
});
