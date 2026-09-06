import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { CLIENT_APP_CONFIG_GLOBAL_KEY, setClientAppConfig } from "../../kernel/client/appConfig.js";
import { RealtimeClientProvider } from "../src/client/RealtimeClientProvider.js";
import { RealtimeProvider } from "../src/server/RealtimeProvider.js";
import { registerSocketAudienceBootstrap } from "../src/server/realtimeAudience.js";
import { createRealtimeDelivery } from "../src/server/realtimeDelivery.js";

const logger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

function createIoDouble() {
  const emitted = [];
  return {
    emitted,
    emit(eventName, payload) { emitted.push({ room: null, eventName, payload }); },
    to(room) {
      return {
        emit(eventName, payload) { emitted.push({ room, eventName, payload }); }
      };
    }
  };
}

test("RealtimeProvider assembles an event-driven runtime capability", async () => {
  let events = null;
  let realtime = null;
  const probe = defineProvider({
    id: "test.realtime.probe",
    requires: { eventsCapability: "runtime.events", realtimeCapability: "runtime.realtime" },
    setup({ eventsCapability, realtimeCapability }) {
      events = eventsCapability;
      realtime = realtimeCapability;
      return {};
    }
  });
  const fastify = { server: createServer() };
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.config": {},
      "runtime.env": {},
      "runtime.fastify": fastify,
      "runtime.logger": logger
    },
    providers: [EventProvider, RealtimeProvider, probe]
  });

  await runtime.start();
  assert.deepEqual(events.diagnostics().listenerIds, ["runtime.realtime.delivery"]);
  assert.equal(typeof realtime.diagnostics, "function");
  assert.equal(realtime.diagnostics().redisConfigured, false);
  await runtime.shutdown();
});

test("realtime delivery sends explicit action events to their selected rooms", async () => {
  const io = createIoDouble();
  const delivery = createRealtimeDelivery({ io, logger });
  await delivery.handle({
    type: "entity.changed",
    source: "workspace",
    entity: "settings",
    operation: "updated",
    entityId: "11",
    scope: { kind: "workspace", id: "11" },
    realtime: {
      event: "workspace.settings.changed",
      audience: "event_scope",
      payload: { workspaceSlug: "acme" }
    }
  });

  assert.deepEqual(io.emitted, [{
    room: ["workspace:11"],
    eventName: "workspace.settings.changed",
    payload: {
      workspaceSlug: "acme",
      type: "entity.changed",
      source: "workspace",
      entity: "settings",
      operation: "updated",
      entityId: "11",
      scope: { kind: "workspace", id: "11" }
    }
  }]);
  assert.equal(Object.hasOwn(io.emitted[0].payload, "realtime"), false);
});

test("realtime delivery resolves an explicit database-backed audience without exposing query controls", async () => {
  const io = createIoDouble();
  const delivery = createRealtimeDelivery({
    io,
    logger,
    database: {
      knex() {}
    }
  });
  await delivery.handle({
    type: "entity.changed",
    source: "workspace",
    entity: "invite",
    operation: "created",
    entityId: "91",
    realtime: {
      event: "users.bootstrap.changed",
      audience: {
        preset: "none",
        async userQuery({ knex, event }) {
          assert.equal(typeof knex, "function");
          assert.equal(event.entityId, "91");
          return [{ user_id: 55 }];
        }
      }
    }
  });
  assert.equal(io.emitted.length, 1);
  assert.deepEqual(io.emitted[0].room, ["user:55"]);
  assert.equal(Object.hasOwn(io.emitted[0].payload, "realtime"), false);
});

test("socket audience bootstrap authenticates explicitly and joins actor workspace rooms", async () => {
  let connectionHandler = null;
  const io = {
    on(eventName, handler) {
      if (eventName === "connection") connectionHandler = handler;
    }
  };
  const authenticateCalls = [];
  registerSocketAudienceBootstrap({
    io,
    logger,
    authService: {
      async authenticateRequest(input) {
        authenticateCalls.push(input);
        return { authenticated: true, actor: { id: 9 } };
      }
    },
    workspaces: {
      repositories: {
        workspaceMemberships: {
          async listActiveWorkspaceIdsByUserId(userId) {
            assert.equal(userId, "9");
            return [11, 12];
          }
        }
      }
    }
  });
  const joinedRooms = [];
  const socket = {
    handshake: { headers: { cookie: "session=abc123; theme=dark", host: "127.0.0.1:3100" } },
    request: { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    data: {},
    join(room) { joinedRooms.push(room); }
  };
  await connectionHandler(socket);
  assert.deepEqual(authenticateCalls, [{
    cookies: { session: "abc123", theme: "dark" },
    headers: { host: "127.0.0.1:3100" },
    socket: { remoteAddress: "127.0.0.1" }
  }]);
  assert.equal(socket.data.actorId, "9");
  assert.deepEqual(joinedRooms, [
    "clients", "users", "user:9",
    "workspace:11", "workspace:11:user:9",
    "workspace:12", "workspace:12:user:9"
  ]);
});

test("socket audience bootstrap rejects unauthenticated handshakes when the auth service requires them", async () => {
  let connectionHandler = null;
  let authenticationMiddleware = null;
  const io = {
    on(eventName, handler) {
      if (eventName === "connection") connectionHandler = handler;
    },
    use(handler) {
      authenticationMiddleware = handler;
    }
  };
  registerSocketAudienceBootstrap({
    io,
    logger,
    authService: {
      realtime: { requireAuthentication: true },
      async authenticateRequest(request) {
        return request.cookies.session === "valid"
          ? { authenticated: true, actor: { id: 17 } }
          : { authenticated: false, actor: null };
      }
    }
  });

  const rejected = [];
  await authenticationMiddleware({
    data: {},
    handshake: { headers: { cookie: "session=invalid" } },
    request: { headers: {} }
  }, (error) => rejected.push(error));
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].data.code, "AUTHENTICATION_REQUIRED");

  const socket = {
    data: {},
    handshake: { headers: { cookie: "session=valid" } },
    request: { headers: {} },
    join(room) {
      this.joinedRooms ||= [];
      this.joinedRooms.push(room);
    }
  };
  let acceptedError = "not-called";
  await authenticationMiddleware(socket, (error) => {
    acceptedError = error;
  });
  assert.equal(acceptedError, undefined);
  await connectionHandler(socket);
  assert.equal(socket.data.actorId, "17");
  assert.deepEqual(socket.joinedRooms, ["clients", "users", "user:17"]);
});

async function startRealtimeClient({ mobile = null } = {}) {
  const registrations = new Map();
  const provided = new Map();
  let realtime = null;
  const probe = defineProvider({
    id: "test.realtime.client.probe",
    requires: { value: "client.realtime" },
    setup({ value }) {
      realtime = value;
      return {};
    }
  });
  const inputs = {
    "client.components": {
      register(id, component) {
        registrations.set(id, component);
      }
    },
    "client.env": {},
    "client.logger": logger,
    "client.vue": {
      provide(id, value) {
        provided.set(id, value);
      }
    }
  };
  if (mobile) {
    inputs["client.mobile"] = mobile;
  }
  const runtime = createCapabilityRuntime({
    inputs,
    providers: [RealtimeClientProvider, probe]
  });
  await runtime.start();
  return { provided, realtime, registrations, runtime };
}

test("RealtimeClientProvider publishes one explicit client capability", async () => {
  const fixture = await startRealtimeClient();
  assert.equal(typeof fixture.realtime.createSocketIoClient, "function");
  assert.equal(typeof fixture.realtime.disconnectSocketIoClient, "function");
  assert.equal(fixture.realtime.config.url, "");
  assert.equal(fixture.registrations.has("realtime.web.connection.indicator"), true);
  assert.equal(
    fixture.provided.get("jskit.realtime.runtime.client.socket"),
    fixture.realtime.socket
  );
  await fixture.runtime.shutdown();
});

for (const [name, available, expectedUrl] of [
  ["uses the configured API URL inside Capacitor", true, "http://127.0.0.1:3000"],
  ["keeps web socket connections URL-less outside Capacitor", false, ""]
]) {
  test(`RealtimeClientProvider ${name}`, async () => {
    const previousAppConfig = globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY];
    try {
      setClientAppConfig({ mobile: { enabled: true, apiBaseUrl: "http://127.0.0.1:3000" } });
      const fixture = await startRealtimeClient({
        mobile: { adapter: { available } }
      });
      assert.equal(fixture.realtime.config.url, expectedUrl);
      await fixture.runtime.shutdown();
    } finally {
      if (previousAppConfig === undefined) delete globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY];
      else globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY] = previousAppConfig;
    }
  });
}
