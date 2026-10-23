import assert from "node:assert/strict";
import test from "node:test";
import { googleCalendarProvider } from "../../connector-google-calendar/src/server/provider.js";
import { createConnectionService, createEnvironmentReferenceResolver } from "../src/server/index.js";
import { validateIntegrationConfiguration } from "../src/shared/configuration.js";

const listScope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const owner = { applicationId: "app-1", subjectId: "app" };
const integrationId = "calendar";

function configuration({ accountMode = "shared", method = "oauth2", refreshTokenRef = "env:GOOGLE_REFRESH_TOKEN", grantType } = {}) {
  return {
    schemaVersion: 1,
    integrations: {
      calendar: {
        provider: "google-calendar", accountMode, scopes: [listScope],
        authentication: method === "oauth2"
          ? { method, registrationRef: "google", ...(refreshTokenRef ? { refreshTokenRef } : {}) }
          : { method, secretRef: "env:KEY", refreshTokenRef },
        settings: {}
      }
    },
    registrations: {
      google: {
        source: "own", clientId: "client-1", clientSecretRef: "env:GOOGLE_SECRET",
        ...(grantType ? { grantType, tokenEndpointAuthMethod: "client_secret_basic" } : { callbackUrlRef: "env:CALLBACK" })
      }
    }
  };
}

function memoryStore() {
  const connections = new Map();
  return {
    connections,
    async withConnection({ integrationId: id }, run) {
      let pending = structuredClone(connections.get(id) || null);
      const result = await run({
        connection: pending,
        save: async (value) => { pending = structuredClone(value); },
        remove: async () => { pending = null; },
        putAttempt: async () => {},
        consumeAttempt: async () => null
      });
      if (pending) connections.set(id, pending);
      else connections.delete(id);
      return result;
    }
  };
}

function setup({ env = { GOOGLE_REFRESH_TOKEN: "seed-token-1" } } = {}) {
  const variables = { GOOGLE_SECRET: "client-secret", CALLBACK: "http://127.0.0.1:8080/callback", ...env };
  const store = memoryStore();
  const refreshes = [];
  const revoked = new Set();
  let time = 1_000_000;
  const service = createConnectionService({
    configuration: configuration(),
    providers: [googleCalendarProvider],
    store,
    authorize: async (context) => context,
    resolveReference: createEnvironmentReferenceResolver(variables),
    now: () => time,
    async fetchImpl(url, init) {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(init.body);
        const refreshToken = body.get("refresh_token");
        refreshes.push(refreshToken);
        if (revoked.has(refreshToken)) return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({
          token_type: "Bearer", access_token: `access-${refreshes.length}`, refresh_token: `rotated-${refreshes.length}`,
          expires_in: 3600, scope: listScope
        });
      }
      return Response.json({ kind: "calendar#calendarList", items: [] });
    }
  });
  const call = () => service.invoke({ context: owner, integrationId, operation: googleCalendarProvider.checkOperation });
  return { service, store, variables, refreshes, revoked, call, advance: (ms) => { time += ms; } };
}

test("refreshTokenRef is accepted only on a shared OAuth integration with a browser registration", () => {
  const validate = (config) => validateIntegrationConfiguration(config, { providers: [googleCalendarProvider] });
  assert.equal(validate(configuration()).integrations.calendar.authentication.refreshTokenRef, "env:GOOGLE_REFRESH_TOKEN");
  const refused = [
    [configuration({ accountMode: "per-user" }), "Only a shared connection can start from a refresh token in Env."],
    [configuration({ grantType: "client_credentials" }), "Client credentials do not use a refresh token."],
    [configuration({ method: "api-key" }), "Only an OAuth connection can start from a refresh token."]
  ];
  for (const [config, message] of refused) {
    assert.throws(() => validate(config), (error) => error.fieldErrors["integrations.calendar.authentication.refreshTokenRef"] === message);
  }
  assert.throws(() => validate(configuration({ refreshTokenRef: "a-raw-token" })), { code: "integration_configuration_invalid" });
});

test("the Env refresh token seeds the shared connection, which then refreshes on its own", async () => {
  const { service, store, refreshes, call, advance } = setup();
  assert.deepEqual(await service.status({ context: owner, integrationId }), {
    status: "connected", source: "env", provider: "google-calendar", integrationId, grantedScopes: [listScope],
    callbackUrl: "http://127.0.0.1:8080/callback"
  });

  await call();
  assert.deepEqual(refreshes, ["seed-token-1"]);
  const stored = store.connections.get(integrationId);
  assert.equal(stored.source, "env");
  assert.equal(stored.tokens.refreshToken, "rotated-1");
  assert.equal(JSON.stringify(stored).includes("seed-token-1"), false, "the seed itself is not kept once rotated");
  assert.equal((await service.status({ context: owner, integrationId })).source, "env");

  await call();
  assert.deepEqual(refreshes, ["seed-token-1"], "a valid access token is reused");
  advance(3600 * 1000);
  await call();
  assert.deepEqual(refreshes, ["seed-token-1", "rotated-1"], "the rotated token renews, not the seed");
});

test("a replaced Env value reseeds on the next call", async () => {
  const { variables, refreshes, call } = setup();
  await call();
  variables.GOOGLE_REFRESH_TOKEN = "seed-token-2";
  await call();
  assert.deepEqual(refreshes, ["seed-token-1", "seed-token-2"]);
});

test("a revoked Env token asks for a new value, and a new value recovers", async () => {
  const { service, variables, revoked, call } = setup();
  revoked.add("seed-token-1");
  await assert.rejects(call(), {
    code: "connector_reconnect_required",
    message: "The refresh token in Env no longer works; replace that Env value."
  });
  assert.equal((await service.status({ context: owner, integrationId })).status, "reconnect-required");
  variables.GOOGLE_REFRESH_TOKEN = "seed-token-2";
  assert.equal((await service.status({ context: owner, integrationId })).status, "connected");
  await call();
});

test("an Env-seeded connection is not disconnected or reconnected in the app", async () => {
  const { service, call } = setup();
  await call();
  const envManaged = { code: "connector_env_managed", statusCode: 409, message: "This connection comes from an Env value; unlink or replace that value instead." };
  await assert.rejects(service.disconnect({ context: owner, integrationId }), envManaged);
  await assert.rejects(service.beginAuthorization({ context: owner, integrationId }), envManaged);
});

test("a missing Env value reads as unconfigured", async () => {
  const { service, call } = setup({ env: {} });
  assert.deepEqual(await service.status({ context: owner, integrationId }), { status: "unconfigured", configurationError: "connector_binding_missing" });
  await assert.rejects(call(), { code: "connector_binding_missing" });
});
