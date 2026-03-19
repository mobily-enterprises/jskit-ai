import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  createDomainEvents,
  installServiceRegistrationApi
} from "@jskit-ai/kernel/server/runtime";

import { RealtimeServiceProvider } from "../src/server/RealtimeServiceProvider.js";
import { RealtimeClientProvider } from "../src/client/RealtimeClientProvider.js";
import { registerRealtimeClientListener } from "../src/client/listeners.js";
import {
  REALTIME_RUNTIME_SERVER_TOKEN,
  REALTIME_SOCKET_IO_SERVER_TOKEN
} from "../src/server/tokens.js";
import {
  REALTIME_RUNTIME_CLIENT_TOKEN,
  REALTIME_SOCKET_CLIENT_TOKEN
} from "../src/client/tokens.js";

function createSingletonApp() {
  const instances = new Map();
  const singletons = new Map();
  const tags = new Map();
  return {
    instances,
    singletons,
    tags,
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    instance(token, value) {
      instances.set(token, value);
    },
    has(token) {
      return instances.has(token) || singletons.has(token);
    },
    tag(token, tagName) {
      const normalizedTagName = String(tagName || "").trim();
      if (!tags.has(normalizedTagName)) {
        tags.set(normalizedTagName, new Set());
      }
      tags.get(normalizedTagName).add(token);
    },
    resolveTag(tagName) {
      const normalizedTagName = String(tagName || "").trim();
      const tagged = tags.get(normalizedTagName);
      if (!tagged || tagged.size < 1) {
        return [];
      }
      return [...tagged].map((token) => this.make(token));
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Missing token: ${String(token)}`);
      }
      const resolved = singletons.get(token)(this);
      instances.set(token, resolved);
      return resolved;
    }
  };
}

test("RealtimeServiceProvider registers runtime realtime server api", () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Fastify, {
    server: createServer()
  });
  const provider = new RealtimeServiceProvider();
  provider.register(app);

  assert.equal(app.singletons.has(REALTIME_RUNTIME_SERVER_TOKEN), true);
  assert.equal(app.singletons.has(REALTIME_SOCKET_IO_SERVER_TOKEN), true);

  const api = app.make(REALTIME_RUNTIME_SERVER_TOKEN);
  assert.equal(typeof api.createSocketIoServer, "function");
  assert.equal(typeof api.closeSocketIoServer, "function");
});

test("RealtimeServiceProvider boot starts socket io and shutdown closes it", async () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Fastify, {
    server: createServer()
  });

  const provider = new RealtimeServiceProvider();
  provider.register(app);
  provider.boot(app);

  const io = app.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
  assert.equal(Boolean(io), true);
  assert.equal(typeof io.on, "function");

  await provider.shutdown(app);
});

test("RealtimeClientProvider registers runtime realtime client api", () => {
  const app = createSingletonApp();
  const provider = new RealtimeClientProvider();
  provider.register(app);

  assert.equal(app.singletons.has(REALTIME_RUNTIME_CLIENT_TOKEN), true);
  assert.equal(app.singletons.has(REALTIME_SOCKET_CLIENT_TOKEN), true);
  assert.equal(app.singletons.has("realtime.web.connection.indicator"), true);
  const api = app.make(REALTIME_RUNTIME_CLIENT_TOKEN);
  assert.equal(typeof api.createSocketIoClient, "function");
  assert.equal(typeof api.disconnectSocketIoClient, "function");
});

test("RealtimeClientProvider boots socket listeners and disconnects on shutdown", async () => {
  const app = createSingletonApp();
  const provider = new RealtimeClientProvider();
  provider.register(app);

  const handlers = new Map();
  const anyHandlers = new Set();
  const socket = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    off(event, handler) {
      if (handlers.get(event) === handler) {
        handlers.delete(event);
      }
    },
    onAny(handler) {
      anyHandlers.add(handler);
    },
    offAny(handler) {
      anyHandlers.delete(handler);
    },
    emitEvent(event, payload) {
      const handler = handlers.get(event);
      if (typeof handler === "function") {
        handler(payload);
      }
      for (const next of anyHandlers) {
        next(event, payload);
      }
    }
  };

  let disconnectCalls = 0;
  app.instance(REALTIME_RUNTIME_CLIENT_TOKEN, {
    createSocketIoClient() {
      return socket;
    },
    disconnectSocketIoClient() {
      disconnectCalls += 1;
    }
  });

  const received = [];
  registerRealtimeClientListener(app, "test.realtime.listener", () => ({
    listenerId: "test.realtime.listener",
    event: "customers.record.changed",
    handle({ event, payload }) {
      received.push({
        event,
        payload
      });
    }
  }));

  await provider.boot(app);
  socket.emitEvent("customers.record.changed", {
    id: 10
  });
  await Promise.resolve();
  await provider.shutdown(app);

  assert.deepEqual(received, [
    {
      event: "customers.record.changed",
      payload: {
        id: 10
      }
    }
  ]);
  assert.equal(disconnectCalls, 1);
});

test("RealtimeServiceProvider bridges service event metadata to socket emissions", async () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Fastify, {
    server: createServer()
  });
  app.singleton("authService", () => ({
    async authenticateRequest() {
      return {
        authenticated: false
      };
    }
  }));
  app.singleton("workspaceMembershipsRepository", () => ({
    async listActiveWorkspaceIdsByUserId() {
      return [];
    }
  }));
  installServiceRegistrationApi(app);
  app.singleton("domainEvents", (scope) => createDomainEvents(scope));
  app.service(
    "test.customers.service",
    () => ({
      async createRecord() {
        return { id: 17, name: "Ada" };
      }
    }),
    {
      events: {
        createRecord: [
          {
            type: "entity.changed",
            source: "crud",
            entity: "record",
            operation: "created",
            realtime: {
              event: "customers.record.changed"
            }
          }
        ]
      }
    }
  );

  const provider = new RealtimeServiceProvider();
  provider.register(app);
  await provider.boot(app);

  const io = app.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
  const emitted = [];
  io.to = (room) => {
    return {
      emit(eventName, payload) {
        emitted.push({
          room,
          eventName,
          payload
        });
        return null;
      }
    };
  };

  const service = app.make("test.customers.service");
  await service.createRecord({
    context: {
      visibilityContext: {
        visibility: "workspace",
        scopeOwnerId: 24
      }
    }
  });
  await provider.shutdown(app);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].room, "workspace:24");
  assert.equal(emitted[0].eventName, "customers.record.changed");
  assert.equal(emitted[0].payload?.source, "crud");
  assert.equal(emitted[0].payload?.operation, "created");
});

test("RealtimeServiceProvider resolves custom audience callback", async () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Fastify, {
    server: createServer()
  });
  app.singleton("authService", () => ({
    async authenticateRequest() {
      return {
        authenticated: false
      };
    }
  }));
  app.singleton("workspaceMembershipsRepository", () => ({
    async listActiveWorkspaceIdsByUserId() {
      return [];
    }
  }));
  installServiceRegistrationApi(app);
  app.singleton("domainEvents", (scope) => createDomainEvents(scope));
  app.service(
    "test.customers.service",
    () => ({
      async updateRecord() {
        return { id: 88 };
      }
    }),
    {
      events: {
        updateRecord: [
          {
            type: "entity.changed",
            source: "crud",
            entity: "record",
            operation: "updated",
            realtime: {
              event: "customers.record.changed",
              audience: ({ event }) => ({
                userId: event?.actorId
              })
            }
          }
        ]
      }
    }
  );

  const provider = new RealtimeServiceProvider();
  provider.register(app);
  await provider.boot(app);

  const io = app.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
  const emitted = [];
  io.to = (room) => {
    return {
      emit(eventName, payload) {
        emitted.push({
          room,
          eventName,
          payload
        });
        return null;
      }
    };
  };

  const service = app.make("test.customers.service");
  await service.updateRecord(
    {
      id: 88
    },
    {
      context: {
        actor: {
          id: 9
        }
      }
    }
  );
  await provider.shutdown(app);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].room, "user:9");
  assert.equal(emitted[0].eventName, "customers.record.changed");
  assert.equal(emitted[0].payload?.operation, "updated");
});

test("RealtimeServiceProvider merges custom realtime payload with canonical domain event fields", async () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Fastify, {
    server: createServer()
  });
  app.singleton("authService", () => ({
    async authenticateRequest() {
      return {
        authenticated: false
      };
    }
  }));
  app.singleton("workspaceMembershipsRepository", () => ({
    async listActiveWorkspaceIdsByUserId() {
      return [];
    }
  }));
  installServiceRegistrationApi(app);
  app.singleton("domainEvents", (scope) => createDomainEvents(scope));
  app.service(
    "test.workspace.service",
    () => ({
      async updateWorkspace() {
        return { id: 11, slug: "acme" };
      }
    }),
    {
      events: {
        updateWorkspace: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "settings",
            operation: "updated",
            realtime: {
              event: "workspace.settings.changed",
              payload: ({ result }) => ({
                workspaceSlug: result?.slug || ""
              }),
              audience: "event_scope"
            }
          }
        ]
      }
    }
  );

  const provider = new RealtimeServiceProvider();
  provider.register(app);
  await provider.boot(app);

  const io = app.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
  const emitted = [];
  io.to = (room) => {
    return {
      emit(eventName, payload) {
        emitted.push({
          room,
          eventName,
          payload
        });
        return null;
      }
    };
  };

  const service = app.make("test.workspace.service");
  await service.updateWorkspace(
    {
      id: 11,
      slug: "acme"
    },
    {
      context: {
        visibilityContext: {
          visibility: "workspace",
          scopeOwnerId: 11
        },
        actor: {
          id: 4
        }
      }
    }
  );
  await provider.shutdown(app);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].room, "workspace:11");
  assert.equal(emitted[0].eventName, "workspace.settings.changed");
  assert.equal(emitted[0].payload?.workspaceSlug, "acme");
  assert.equal(emitted[0].payload?.source, "workspace");
  assert.equal(emitted[0].payload?.entity, "settings");
  assert.equal(emitted[0].payload?.operation, "updated");
  assert.equal(emitted[0].payload?.scope?.kind, "workspace");
  assert.equal(emitted[0].payload?.scope?.id, 11);
});

test("RealtimeServiceProvider emits only the matching dispatcher event for each service method event", async () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Fastify, {
    server: createServer()
  });
  app.singleton("authService", () => ({
    async authenticateRequest() {
      return {
        authenticated: false
      };
    }
  }));
  app.singleton("workspaceMembershipsRepository", () => ({
    async listActiveWorkspaceIdsByUserId() {
      return [];
    }
  }));
  installServiceRegistrationApi(app);
  app.singleton("domainEvents", (scope) => createDomainEvents(scope));
  app.service(
    "test.workspace.settings.service",
    () => ({
      async updateSettings() {
        return { id: 11 };
      }
    }),
    {
      events: {
        updateSettings: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "settings",
            operation: "updated",
            realtime: {
              event: "workspace.settings.changed",
              audience: "event_scope"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            realtime: {
              event: "users.bootstrap.changed",
              audience: "event_scope"
            }
          }
        ]
      }
    }
  );

  const provider = new RealtimeServiceProvider();
  provider.register(app);
  await provider.boot(app);

  const io = app.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
  const emitted = [];
  io.to = (room) => {
    return {
      emit(eventName, payload) {
        emitted.push({
          room,
          eventName,
          payload
        });
        return null;
      }
    };
  };

  const service = app.make("test.workspace.settings.service");
  await service.updateSettings(
    { id: 11 },
    {
      context: {
        actor: {
          id: 4
        },
        visibilityContext: {
          visibility: "workspace",
          scopeOwnerId: 11
        }
      }
    }
  );
  await provider.shutdown(app);

  assert.equal(emitted.length, 2);
  assert.deepEqual(
    emitted.map((entry) => entry.eventName).sort(),
    ["users.bootstrap.changed", "workspace.settings.changed"]
  );
});
