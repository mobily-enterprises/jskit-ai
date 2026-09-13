import { resendProvider } from "../../connectors-catalog/src/server/resend.js";
import { firecrawlProvider } from "../../connectors-catalog/src/server/firecrawl.js";
import { mailgunDefinition } from "../../connectors-catalog/src/shared/tokens.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { googleCalendarProvider } from "../../connector-google-calendar/src/server/provider.js";
import { createConnectionService, createConnectorsFeature, createEnvironmentReferenceResolver } from "../src/server/index.js";
import { parseIntegrationConfiguration, validateIntegrationConfiguration } from "../src/shared/configuration.js";
import { clickhouseProvider } from "../../connectors-catalog/src/server/clickhouse.js";

const listScope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const eventsScope = "https://www.googleapis.com/auth/calendar.events.readonly";
const owner = { applicationId: "app-1", subjectId: "user-1" };
const callback = "http://127.0.0.1:8080/connections/callback";

function databaseConfiguration(authentication) {
  return { schemaVersion: 1, registrations: {}, integrations: { database: {
    provider: "clickhouse", accountMode: "shared", scopes: [], authentication,
    settings: { httpUrl: "https://database.example:8443/" }
  } } };
}

test("credential-free and optional-secret configuration are explicit provider capabilities", () => {
  const parse = (config, provider = clickhouseProvider) => validateIntegrationConfiguration(config, { providers: [provider] });
  const config = databaseConfiguration({ method: "none" });
  assert.deepEqual(parse(config), config);
  for (const field of ["secretRef", "registrationRef"]) {
    const mixed = structuredClone(config);
    mixed.integrations.database.authentication[field] = field === "secretRef" ? "env:UNUSED" : "registration";
    assert.throws(() => parse(mixed), (error) => Boolean(error.fieldErrors[`integrations.database.authentication.${field}`]));
  }
  config.integrations.database.settings.username = "ignored-user";
  assert.throws(() => parse(config), (error) => Boolean(error.fieldErrors["integrations.database.settings.username"]));
  delete config.integrations.database.settings.username;
  assert.throws(() => parse(config, { ...clickhouseProvider, authenticationMethods: ["api-key"] }), (error) => Boolean(error.fieldErrors["integrations.database.authentication.method"]));
  const optional = databaseConfiguration({ method: "api-key" });
  assert.deepEqual(parse(optional), optional);
  assert.throws(() => parse(optional, { ...clickhouseProvider, apiKeySecretOptional: false }), (error) => Boolean(error.fieldErrors["integrations.database.authentication.secretRef"]));
  optional.integrations.database.authentication.secretRef = "raw-password";
  assert.throws(() => parse(optional), (error) => Boolean(error.fieldErrors["integrations.database.authentication.secretRef"]));
});

test("credential-free grants require verification, authorize access and invalidate both directions of a mode change", async () => {
  const requests = [];
  let resolutions = 0;
  const options = {
    configuration: databaseConfiguration({ method: "none" }), providers: [clickhouseProvider],
    store: memoryStore(), authorize: async (context) => context,
    resolveReference: async () => { resolutions++; return "secret"; },
    fetchImpl: async (url, init) => { requests.push({ url, init }); return Response.json({ meta: [], data: [{ ok: 1, user: "default" }], rows: 1 }); }
  };
  const service = createConnectionService(options);
  const input = { context: owner, integrationId: "database" };
  await assert.rejects(service.invoke({ ...input, operation: "connection.check" }), { code: "connector_reconnect_required" });
  await assert.rejects(service.connectApiKey(input), { code: "connector_mode_unavailable" });
  await service.connectWithoutCredentials(input);
  assert.equal(resolutions, 0);
  assert.equal(new Headers(requests[0].init.headers).has("authorization"), false);
  const restart = createConnectionService(options);
  assert.equal((await restart.status(input)).status, "connected");
  await restart.invoke({ ...input, operation: "connection.check" });
  await assert.rejects(restart.invoke({ ...input, context: { ...owner, subjectId: "other" }, operation: "connection.check" }), { code: "connector_reconnect_required" });
  const keyed = createConnectionService({ ...options, configuration: databaseConfiguration({ method: "api-key", secretRef: "env:PASSWORD" }) });
  assert.equal((await keyed.status(input)).status, "reconnect-required");
  await assert.rejects(keyed.invoke({ ...input, operation: "connection.check" }), { code: "connector_reconnect_required" });
  await assert.rejects(keyed.connectWithoutCredentials(input), { code: "connector_mode_unavailable" });
  assert.equal(resolutions, 0);
  await keyed.connectApiKey(input);
  assert.equal(resolutions, 1);
  assert.equal((await restart.status(input)).status, "reconnect-required");
  await assert.rejects(restart.invoke({ ...input, operation: "connection.check" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, 3);
  await restart.connectWithoutCredentials(input);
  assert.equal(new Headers(requests.at(-1).init.headers).has("authorization"), false);
  await restart.disconnect(input);
  assert.equal((await restart.status(input)).status, "disconnected");
});

test("the ordinary credential-free Feature action verifies without resolving references", async () => {
  const contexts = [];
  let actions;
  const options = {
    configuration: databaseConfiguration({ method: "none" }), providers: [clickhouseProvider], store: memoryStore(),
    authorize: async (context) => { contexts.push(context); return context; },
    resolveReference: async () => { throw new Error("Must not resolve a reference"); },
    fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init.headers).has("authorization"), false);
      return Response.json({ meta: [], data: [{ ok: 1, user: "default" }], rows: 1 });
    }
  };
  const runtime = createCapabilityRuntime({ providers: [
    createActionProvider(), createConnectorsFeature(options),
    defineProvider({ id: "test.credential-free-observer", requires: { catalogue: "runtime.actions" }, setup({ catalogue }) { actions = catalogue; } })
  ] });
  await runtime.start();
  try {
    const result = await actions.execute({ actionId: "connectors.verifyWithoutCredentials", input: { integrationId: "database" },
      context: { ...owner, channel: "api", surface: "app" } });
    assert.equal(result.status, "connected");
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].subjectId, owner.subjectId);
  } finally { await runtime.shutdown(); }
});

function configuration() {
  return {
    schemaVersion: 1,
    integrations: {
      calendar: {
        provider: "google-calendar", accountMode: "per-user", scopes: [listScope, eventsScope],
        authentication: { method: "oauth2", registrationRef: "google" },
        settings: {}, extensions: { appOwned: { color: "blue" } }
      }
    },
    registrations: { google: { source: "own", clientId: "client-1", clientSecretRef: "env:GOOGLE_SECRET", callbackUrlRef: "env:CALLBACK" } }
  };
}

// Deliberately test-only: applications supply their existing durable, transactional store.
function memoryStore() {
  const attempts = new Map();
  const connections = new Map();
  const locks = new Map();
  const key = ({ owner, integrationId }) => JSON.stringify([owner.applicationId, owner.subjectId, integrationId]);
  return {
    attempts, connections,
    async withConnection(input, run) {
      const id = key(input);
      const prior = locks.get(id) || Promise.resolve();
      let release;
      const lock = new Promise((resolve) => { release = resolve; });
      locks.set(id, lock);
      await prior;
      try {
        let pending = structuredClone(connections.get(id) || null);
        const pendingAttempts = new Map([...attempts].filter(([, attempt]) => key(attempt) === id));
        const result = await run({
          connection: pending,
          save: async (value) => { pending = structuredClone(value); },
          remove: async () => { pending = null; pendingAttempts.clear(); },
          putAttempt: async (attempt) => pendingAttempts.set(attempt.state, structuredClone(attempt)),
          consumeAttempt: async (state) => {
            const attempt = pendingAttempts.get(state);
            pendingAttempts.delete(state);
            return attempt ? structuredClone(attempt) : null;
          }
        });
        for (const [state, attempt] of attempts) if (key(attempt) === id) attempts.delete(state);
        for (const [state, attempt] of pendingAttempts) attempts.set(state, attempt);
        if (pending) connections.set(id, pending);
        else connections.delete(id);
        return result;
      } finally {
        release();
        if (locks.get(id) === lock) locks.delete(id);
      }
    }
  };
}

function setup({ config = configuration(), tokenScopes = `${listScope} ${eventsScope}`, tokenError, providerStatus = 200 } = {}) {
  const store = memoryStore();
  const requests = [];
  let time = 1_000_000;
  const options = {
    configuration: config,
    providers: [googleCalendarProvider], store,
    authorize: async (context) => context,
    resolveReference: createEnvironmentReferenceResolver({ GOOGLE_SECRET: "never-return-this-secret", CALLBACK: callback }),
    now: () => time,
    async fetchImpl(url, init) {
      requests.push({ url: String(url), init });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        if (tokenError) return Response.json({ error: tokenError, error_description: "never-return-this-secret" }, { status: 400 });
        const refresh = new URLSearchParams(init.body).get("grant_type") === "refresh_token";
        return Response.json({
          token_type: "Bearer", access_token: refresh ? "new-access-token" : "access-token",
          refresh_token: refresh ? "rotated-refresh-token" : "refresh-token",
          expires_in: 3600, scope: tokenScopes
        });
      }
      return Response.json(providerStatus === 200 ? {
        kind: String(url).includes("/events") ? "calendar#events" : "calendar#calendarList",
        items: [{ id: "item-1" }], nextPageToken: "next-page"
      } : {
        error: { message: "never-return-this-secret" }
      }, { status: providerStatus });
    }
  };
  const service = createConnectionService(options);
  async function connect(context = owner) {
    const start = await service.beginAuthorization({ context, integrationId: "calendar" });
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    const callbackUrl = `${callback}?code=returned-code&state=${state}`;
    return { callbackUrl, result: await service.completeAuthorization({ context, integrationId: "calendar", callbackUrl }) };
  }
  return { options, service, store, requests, connect, advance: (ms) => { time += ms; } };
}

// Controlled OAuth server using the existing read-operation fixture, not a Google grant capability.
function serviceAccountSetup() {
  const fixture = setup();
  const config = configuration();
  config.integrations.calendar.provider = "test-service";
  config.integrations.calendar.accountMode = "shared";
  config.registrations.google.grantType = "client_credentials";
  config.registrations.google.tokenEndpointAuthMethod = "client_secret_basic";
  delete config.registrations.google.callbackUrlRef;
  const provider = { ...googleCalendarProvider, id: "test-service", oauthGrantTypes: ["authorization_code", "client_credentials"],
    oauthClientAuthenticationMethods: ["client_secret_basic"] };
  const options = { ...fixture.options, configuration: config, providers: [provider],
    resolveReference: async (reference) => {
      assert.equal(reference, "env:GOOGLE_SECRET", "Service accounts must not resolve a callback binding.");
      return "never-return-this-secret";
    } };
  return { ...fixture, options, provider, config, service: createConnectionService(options) };
}

test("client credentials are explicit, confidential, callback-free and cannot impersonate each app user", () => {
  const { config, provider } = serviceAccountSetup();
  const validate = (value, definition = provider) => validateIntegrationConfiguration(value, { providers: [definition] });
  assert.deepEqual(validate(config), config);
  const invalid = (mutate, field) => {
    const value = structuredClone(config);
    mutate(value);
    assert.throws(() => validate(value), (error) => Boolean(error.fieldErrors[field]));
  };
  invalid((value) => { value.registrations.google.callbackUrlRef = "env:CALLBACK"; }, "registrations.google.callbackUrlRef");
  invalid((value) => { delete value.registrations.google.clientSecretRef; }, "registrations.google.clientSecretRef");
  invalid((value) => { value.registrations.google.tokenEndpointAuthMethod = "none"; }, "registrations.google.tokenEndpointAuthMethod");
  invalid((value) => { value.integrations.calendar.accountMode = "per-user"; }, "integrations.calendar.accountMode");
  invalid((value) => { value.registrations.google.grantType = "password"; }, "registrations.google.grantType");
  assert.throws(() => validate(config, { ...provider, oauthGrantTypes: undefined }), (error) => Boolean(error.fieldErrors["registrations.google.grantType"]));
  assert.throws(() => validate(config, { ...provider, scopesForGrantType: (grant) => grant === "client_credentials" ? [{ value: listScope }] : provider.scopes }),
    (error) => Boolean(error.fieldErrors["integrations.calendar.scopes"]));
});

test("service account verification issues a confidential grant without browser state and isolates owners", async () => {
  const { service, requests, store } = serviceAccountSetup();
  const input = { context: owner, integrationId: "calendar" };
  await assert.rejects(service.invoke({ ...input, operation: "calendars.list" }), { code: "connector_reconnect_required" });
  await assert.rejects(service.beginAuthorization(input), { code: "connector_mode_unavailable" });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: callback }), { code: "connector_mode_unavailable" });
  assert.equal(requests.length, 0);
  const result = await service.connectClientCredentials(input);
  assert.equal(result.status, "connected");
  assert.equal(requests.length, 2);
  const parameters = new URLSearchParams(requests[0].init.body);
  assert.equal(parameters.get("grant_type"), "client_credentials");
  assert.equal(parameters.get("scope"), `${listScope} ${eventsScope}`);
  for (const field of ["client_secret", "redirect_uri", "code", "code_verifier", "refresh_token"]) assert.equal(parameters.has(field), false);
  const authorization = new Headers(requests[0].init.headers).get("authorization");
  assert.equal(authorization.split(" ")[0], "Basic");
  assert.deepEqual(Buffer.from(authorization.split(" ")[1], "base64").toString().split(":").map(decodeURIComponent), ["client-1", "never-return-this-secret"]);
  assert.equal(store.attempts.size, 0);
  assert.equal([...store.connections.values()][0].tokens.refreshToken, null);
  assert.equal(/token|secret|client-1/u.test(JSON.stringify(result)), false);
  await assert.rejects(service.invoke({ ...input, context: { ...owner, subjectId: "another" }, operation: "calendars.list" }), { code: "connector_reconnect_required" });
  await service.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("service account renewal is serialized, requests only its verified grant and survives a failed API read", async () => {
  const { options, requests, advance, store, provider } = serviceAccountSetup();
  const optionsWithVerification = { ...options, providers: [{ ...provider, grantedScopesFromVerification: () => [listScope] }] };
  const service = createConnectionService(optionsWithVerification);
  const input = { context: owner, integrationId: "calendar" };
  await service.connectClientCredentials(input);
  advance(3_600_000);
  await Promise.all([service.invoke({ ...input, operation: "calendars.list" }), service.invoke({ ...input, operation: "calendars.list" })]);
  const grants = requests.filter((entry) => entry.url.endsWith("/token"));
  assert.equal(grants.length, 2);
  assert.equal(new URLSearchParams(grants[1].init.body).get("scope"), listScope);
  assert.deepEqual((await service.status(input)).grantedScopes, [listScope]);
  await assert.rejects(service.invoke({ ...input, operation: "events.list", input: { calendarId: "primary" } }), { code: "connector_scope_missing" });
  advance(3_600_000);
  const failing = createConnectionService({ ...optionsWithVerification, fetchImpl: async (url, init) =>
    String(url).endsWith("/token") ? options.fetchImpl(url, init) : Response.json({ message: "secret" }, { status: 403 }) });
  await assert.rejects(failing.invoke({ ...input, operation: "calendars.list" }), { code: "connector_permission_denied" });
  assert.equal([...store.connections.values()][0].tokens.expiresAt, options.now() + 3_600_000);
  const before = requests.length;
  await service.invoke({ ...input, operation: "calendars.list" });
  assert.equal(requests.length, before + 1);
});

test("changing service account scopes or OAuth flow requires an explicit reconnection", async () => {
  const { service, options, config, requests } = serviceAccountSetup();
  const input = { context: owner, integrationId: "calendar" };
  await service.connectClientCredentials(input);
  const scoped = structuredClone(config);
  scoped.integrations.calendar.scopes = [listScope];
  const reduced = createConnectionService({ ...options, configuration: scoped });
  assert.equal((await reduced.status(input)).status, "reconnect-required");
  await assert.rejects(reduced.invoke({ ...input, operation: "calendars.list" }), { code: "connector_reconnect_required" });
  const code = structuredClone(config);
  code.registrations.google.grantType = "authorization_code";
  code.registrations.google.callbackUrlRef = "env:CALLBACK";
  const browser = createConnectionService({ ...options, configuration: code,
    resolveReference: async (ref) => ref === "env:CALLBACK" ? callback : "never-return-this-secret" });
  assert.equal((await browser.status(input)).status, "reconnect-required");
  await assert.rejects(browser.invoke({ ...input, operation: "calendars.list" }), { code: "connector_reconnect_required" });
  await assert.rejects(browser.connectClientCredentials(input), { code: "connector_mode_unavailable" });
  assert.equal(requests.length, 2);
  const start = await browser.beginAuthorization(input);
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  await browser.completeAuthorization({ ...input, callbackUrl: `${callback}?state=${state}&code=code` });
  assert.equal((await service.status(input)).status, "reconnect-required");
  await assert.rejects(service.invoke({ ...input, operation: "calendars.list" }), { code: "connector_reconnect_required" });
});

test("revoked service account credentials invalidate the grant without exposing the response or retrying", async () => {
  const { service, options, advance } = serviceAccountSetup();
  const input = { context: owner, integrationId: "calendar" };
  await service.connectClientCredentials(input);
  advance(3_600_000);
  let requests = 0;
  const broken = createConnectionService({ ...options, fetchImpl: async () => {
    requests++;
    return Response.json({ error: "invalid_client", error_description: "private-secret" }, { status: 400 });
  } });
  await assert.rejects(broken.invoke({ ...input, operation: "calendars.list" }), (error) => {
    assert.equal(error.code, "connector_reconnect_required");
    assert.equal(JSON.stringify(error).includes("private-secret"), false);
    return true;
  });
  assert.equal(requests, 1);
  assert.equal((await broken.status(input)).status, "reconnect-required");
});

test("unverified and malformed service grants never replace an existing connection", async () => {
  const { service, options, store } = serviceAccountSetup();
  const input = { context: owner, integrationId: "calendar" };
  await service.connectClientCredentials(input);
  const saved = structuredClone([...store.connections.values()][0]);
  for (const response of [{ token_type: "Bearer", expires_in: 3600 }, { token_type: "mac", access_token: "private-token" }]) {
    const malformed = createConnectionService({ ...options, fetchImpl: async () => Response.json(response) });
    await assert.rejects(malformed.connectClientCredentials(input), { code: "connector_provider_failed" });
    assert.deepEqual([...store.connections.values()][0], saved);
  }
  const denied = createConnectionService({ ...options, fetchImpl: async (url, init) => String(url).endsWith("/token")
    ? options.fetchImpl(url, init) : Response.json({ error: "private" }, { status: 403 }) });
  await assert.rejects(denied.connectClientCredentials(input), { code: "connector_permission_denied" });
  assert.deepEqual([...store.connections.values()][0], saved);
  const noAccess = createConnectionService({ ...options, authorize: async () => null, fetchImpl: async () => assert.fail("Denied owner reached provider") });
  await assert.rejects(noAccess.connectClientCredentials(input), { code: "connector_access_denied" });
});

test("cancelling a service token exchange preserves the previous grant without retrying", async () => {
  const { service, options, store } = serviceAccountSetup();
  const input = { context: owner, integrationId: "calendar" };
  await service.connectClientCredentials(input);
  const saved = structuredClone([...store.connections.values()][0]);
  let started;
  const requested = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const waiting = createConnectionService({ ...options, fetchImpl: async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      started();
    });
  } });
  const controller = new AbortController();
  const pending = assert.rejects(waiting.connectClientCredentials({ ...input, signal: controller.signal }), { code: "connector_cancelled" });
  await requested;
  controller.abort();
  await pending;
  assert.equal(calls, 1);
  assert.deepEqual([...store.connections.values()][0], saved);
});

test("the client credentials Feature action uses the ordinary application policy and runtime", async () => {
  const { options } = serviceAccountSetup();
  let actions;
  const runtime = createCapabilityRuntime({ providers: [createActionProvider(), createConnectorsFeature(options),
    defineProvider({ id: "test.service-observer", requires: { catalogue: "runtime.actions" }, setup({ catalogue }) { actions = catalogue; } })] });
  await runtime.start();
  try {
    const result = await actions.execute({ actionId: "connectors.verifyClientCredentials", input: { integrationId: "calendar" },
      context: { ...owner, channel: "api", surface: "app" } });
    assert.equal(result.status, "connected");
  } finally { await runtime.shutdown(); }
});

test("cancelling an HTTP operation preserves its grant and reports interruption without retrying", async () => {
  const { options, connect } = setup();
  await connect();
  let started;
  const requested = new Promise((resolve) => { started = resolve; });
  let requests = 0;
  const service = createConnectionService({
    ...options,
    fetchImpl: async (url, init) => {
      requests += 1;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        started();
      });
    }
  });
  const controller = new AbortController();
  const pending = service.invoke({ context: owner, integrationId: "calendar", operation: "calendars.list", signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "connector_cancelled" });
  await requested;
  controller.abort();
  await rejected;
  assert.equal(requests, 1);
  assert.equal((await service.status({ context: owner, integrationId: "calendar" })).status, "connected");
});

test("provider verification can reduce comma-separated grants without refresh restoring denied permissions", async () => {
  const { options, advance } = setup({ tokenScopes: `${listScope}, ${eventsScope}` });
  let verified = [listScope];
  const provider = { ...googleCalendarProvider, scopeSeparator: ",", grantedScopesFromVerification: () => verified };
  const service = createConnectionService({ ...options, providers: [provider] });
  async function connect() {
    const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
    const url = new URL(start.authorizationUrl);
    assert.equal(url.searchParams.get("scope"), `${listScope},${eventsScope}`);
    return service.completeAuthorization({ context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=fixture-code&state=${url.searchParams.get("state")}` });
  }
  const connected = await connect();
  assert.deepEqual(connected.grantedScopes, [listScope]);
  advance(3_601_000);
  await service.invoke({ context: owner, integrationId: "calendar", operation: googleCalendarProvider.checkOperation });
  assert.deepEqual((await service.status({ context: owner, integrationId: "calendar" })).grantedScopes, [listScope]);
  for (verified of [null, "not-an-array", [7], [""], []]) {
    await assert.rejects(connect(), { code: Array.isArray(verified) && !verified.length ? "connector_scope_missing" : "connector_response_invalid" });
    assert.deepEqual((await service.status({ context: owner, integrationId: "calendar" })).grantedScopes, [listScope]);
  }
});

test("portable configuration round-trips application extensions and rejects raw credentials", () => {
  const input = configuration();
  assert.deepEqual(parseIntegrationConfiguration(JSON.stringify(input), { providers: [googleCalendarProvider] }), input);
  input.registrations.google.clientSecret = "never-return-this-secret";
  assert.throws(() => validateIntegrationConfiguration(input), (error) => {
    assert.equal(error.code, "integration_configuration_invalid");
    assert.ok(error.fieldErrors["registrations.google.clientSecret"]);
    assert.equal(JSON.stringify(error).includes("never-return-this-secret"), false);
    return true;
  });
  assert.throws(() => parseIntegrationConfiguration("not JSON"), /configuration is invalid/);
});

test("reference fields reject pasted web URLs while preserving environment and custom secret bindings", () => {
  for (const field of ["clientSecretRef", "callbackUrlRef"]) {
    for (const value of ["https://callback.example.test/oauth", "http://127.0.0.1:8080/oauth", "https://user:password@example.test/"]) {
      const input = configuration();
      input.registrations.google[field] = value;
      assert.throws(() => validateIntegrationConfiguration(input, { providers: [googleCalendarProvider] }), (error) => {
        assert.ok(error.fieldErrors[`registrations.google.${field}`]);
        assert.equal(JSON.stringify(error).includes(value), false);
        return true;
      });
    }
  }
  const keyed = databaseConfiguration({ method: "api-key", secretRef: "https://example.test/key" });
  assert.throws(() => validateIntegrationConfiguration(keyed, { providers: [clickhouseProvider] }), (error) => Boolean(error.fieldErrors["integrations.database.authentication.secretRef"]));
  for (const value of ["env:CALLBACK", "vault:applications/twitch/secret", "vault://applications/twitch/secret"]) {
    const input = configuration();
    input.registrations.google.clientSecretRef = value;
    assert.equal(validateIntegrationConfiguration(input, { providers: [googleCalendarProvider] }).registrations.google.clientSecretRef, value);
  }
});

test("configuration rejects missing references and unknown scopes", () => {
  const input = configuration();
  input.integrations.calendar.authentication.registrationRef = "missing";
  input.integrations.calendar.scopes = ["arbitrary-permission"];
  assert.throws(() => validateIntegrationConfiguration(input, { providers: [googleCalendarProvider] }), (error) => {
    assert.ok(error.fieldErrors["integrations.calendar.authentication.registrationRef"]);
    assert.ok(error.fieldErrors["integrations.calendar.scopes"]);
    return true;
  });
});

test("a different or coerced schema version is not silently rewritten", () => {
  for (const schemaVersion of ["1", 2, null]) {
    assert.throws(() => validateIntegrationConfiguration({ ...configuration(), schemaVersion }), (error) => {
      assert.ok(error.fieldErrors.schemaVersion);
      return true;
    });
  }
});

test("provider settings use one schema for defaults and field errors while unknown definitions require an explicit editor option", () => {
  const input = { schemaVersion: 1, registrations: {}, integrations: {
    mail: { provider: "mailgun", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:MAILGUN_KEY" } },
    custom: { provider: "custom", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:CUSTOM_KEY" }, settings: { region: "custom-region" } }
  } };
  const options = { providers: [mailgunDefinition], allowUnknownProviders: true };
  const result = validateIntegrationConfiguration(input, options);
  assert.deepEqual(result.integrations.mail.settings, { region: "us" });
  assert.deepEqual(result.integrations.custom, input.integrations.custom);
  assert.equal(input.integrations.mail.settings, undefined);
  assert.throws(() => validateIntegrationConfiguration(input, { providers: [mailgunDefinition] }), (error) => Boolean(error.fieldErrors["integrations.custom.provider"]));
  for (const settings of [{ region: "unknown" }, { region: "eu", arbitrary: "no" }]) {
    input.integrations.mail.settings = settings;
    assert.throws(() => validateIntegrationConfiguration(input, options), (error) => {
      assert.ok(Object.keys(error.fieldErrors).some((field) => field.startsWith("integrations.mail.settings.")));
      return true;
    });
  }
});

test("OAuth attempts and verified grants stay bound to their provider settings", async () => {
  const { service, options, connect, requests } = setup();
  const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  const config = configuration();
  config.integrations.calendar.settings = { resource: "another-account" };
  const changed = createConnectionService({ ...options, configuration: config });
  await assert.rejects(changed.completeAuthorization({ context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=x&state=${state}` }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, 0);
  await connect();
  assert.equal((await changed.status({ context: owner, integrationId: "calendar" })).status, "reconnect-required");
  const count = requests.length;
  await assert.rejects(changed.invoke({ context: owner, integrationId: "calendar", operation: "calendars.list" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, count);
});

test("OAuth uses unique state and PKCE, checks the account, and returns no credentials", async () => {
  const { service, store, requests } = setup();
  const first = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const second = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const url = new URL(first.authorizationUrl);
  assert.notEqual(url.searchParams.get("state"), new URL(second.authorizationUrl).searchParams.get("state"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.has("client_secret"), false);
  const state = url.searchParams.get("state");
  const verifier = store.attempts.get(state).codeVerifier;
  const result = await service.completeAuthorization({
    context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=code&state=${state}`
  });
  assert.equal(result.status, "connected");
  assert.equal(new URLSearchParams(requests[0].init.body).get("code_verifier"), verifier);
  assert.equal(requests[1].init.redirect, "error");
  assert.equal(requests[1].init.headers.Authorization, "Bearer access-token");
  assert.equal(JSON.stringify(result).includes("token"), false);
  assert.equal(store.attempts.has(state), false);
});

test("initial OAuth grants cannot activate permissions omitted from configuration", async () => {
  const config = configuration(); config.integrations.calendar.scopes = [listScope];
  const { service, connect, requests } = setup({ config });
  const { result } = await connect();
  assert.deepEqual(result.grantedScopes, [listScope]);
  const before = requests.length;
  await assert.rejects(service.invoke({ context: owner, integrationId: "calendar", operation: "events.list", input: { calendarId: "primary" } }), { code: "connector_scope_missing" });
  assert.equal(requests.length, before);
});

test("a provider's confidential non-PKCE exception is explicit and bound to the pending attempt", async () => {
  for (const initialPkce of [true, false]) {
    const { options, requests } = setup();
    const service = createConnectionService({ ...options, providers: [{ ...googleCalendarProvider, oauthPkce: initialPkce }] });
    const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
    const url = new URL(start.authorizationUrl);
    assert.equal(url.searchParams.has("code_challenge"), initialPkce);
    const changed = createConnectionService({ ...options, providers: [{ ...googleCalendarProvider, oauthPkce: !initialPkce }] });
    await assert.rejects(changed.completeAuthorization({ context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=code&state=${url.searchParams.get("state")}` }), { code: "connector_attempt_invalid" });
    assert.equal(requests.length, 0);
  }
});

test("a provider cannot disable PKCE for a public client", async () => {
  const { options } = setup(); const config = configuration();
  config.registrations.google.tokenEndpointAuthMethod = "none";
  delete config.registrations.google.clientSecretRef;
  const service = createConnectionService({ ...options, configuration: config,
    providers: [{ ...googleCalendarProvider, oauthPkce: false, oauthClientAuthenticationMethods: ["none"] }] });
  await assert.rejects(service.beginAuthorization({ context: owner, integrationId: "calendar" }), { code: "connector_mode_unavailable" });
});

test("another user or app cannot consume a pending authorization or read the connection", async () => {
  const { service } = setup();
  const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  const callbackUrl = `${callback}?code=code&state=${state}`;
  for (const context of [{ ...owner, subjectId: "user-2" }, { ...owner, applicationId: "app-2" }]) {
    await assert.rejects(service.completeAuthorization({ context, integrationId: "calendar", callbackUrl }), { code: "connector_attempt_invalid" });
    assert.deepEqual(await service.status({ context, integrationId: "calendar" }), { status: "disconnected", callbackUrl: callback });
  }
  await service.completeAuthorization({ context: owner, integrationId: "calendar", callbackUrl });
  await assert.rejects(service.completeAuthorization({ context: owner, integrationId: "calendar", callbackUrl }), { code: "connector_attempt_invalid" });
});

test("wrong callback destination and expired consent never connect an account", async () => {
  const { service, advance, requests } = setup();
  const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  await assert.rejects(service.completeAuthorization({
    context: owner, integrationId: "calendar", callbackUrl: `https://untrusted.example/callback?code=x&state=${state}`
  }), { code: "connector_callback_invalid" });
  advance(600_001);
  await assert.rejects(service.completeAuthorization({
    context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=x&state=${state}`
  }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, 0);
});

test("denied or insufficient consent never records Connected", async () => {
  const { service, requests } = setup();
  const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  await assert.rejects(service.completeAuthorization({
    context: owner, integrationId: "calendar", callbackUrl: `${callback}?error=access_denied&state=${state}`
  }), { code: "connector_consent_denied" });
  assert.equal(requests.length, 0);
  const partial = setup({ tokenScopes: eventsScope });
  await assert.rejects(partial.connect(), { code: "connector_scope_missing" });
  assert.deepEqual(await partial.service.status({ context: owner, integrationId: "calendar" }), { status: "disconnected", callbackUrl: callback });
});

test("simultaneous expired requests refresh once and persist the rotated grant", async () => {
  const { service, connect, advance, requests, store } = setup();
  await connect();
  advance(3_600_001);
  const results = await Promise.all([1, 2].map(() => service.invoke({
    context: owner, integrationId: "calendar", operation: "events.list", input: { pageToken: "page-2", calendarId: "person@example.com" }
  })));
  assert.equal(results.length, 2);
  const refreshes = requests.filter(({ url, init }) => url.endsWith("/token") && new URLSearchParams(init.body).get("grant_type") === "refresh_token");
  assert.equal(refreshes.length, 1);
  assert.equal([...store.connections.values()][0].tokens.refreshToken, "rotated-refresh-token");
  assert.ok(requests.some(({ url }) => url.includes("person%40example.com/events") && url.includes("pageToken=page-2")));
});

test("refresh cannot restore declined scopes or grant unrequested permissions without verification metadata", async () => {
  const { options, connect, advance, store } = setup({ tokenScopes: listScope });
  await connect();
  advance(3_600_001);
  const service = createConnectionService({ ...options, fetchImpl: async (url, init) => {
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({
      token_type: "Bearer", access_token: "refreshed", refresh_token: "rotated",
      expires_in: 3600, scope: `${listScope} ${eventsScope} unexpected-admin`
    });
    return options.fetchImpl(url, init);
  } });
  await service.invoke({ context: owner, integrationId: "calendar", operation: "calendars.list" });
  assert.deepEqual([...store.connections.values()][0].grantedScopes, [listScope]);
  await assert.rejects(service.invoke({ context: owner, integrationId: "calendar", operation: "events.list", input: { calendarId: "primary" } }), { code: "connector_scope_missing" });
});

test("provider failures do not expose response text or return a false connection receipt", async () => {
  const { connect, service } = setup({ tokenError: "invalid_grant" });
  await assert.rejects(connect(), (error) => {
    assert.equal(error.code, "connector_reconnect_required");
    assert.equal(JSON.stringify(error).includes("never-return-this-secret"), false);
    return true;
  });
  assert.deepEqual(await service.status({ context: owner, integrationId: "calendar" }), { status: "disconnected", callbackUrl: callback });
  await assert.rejects(setup({ providerStatus: 429 }).connect(), { code: "connector_rate_limited" });
});

test("an API failure after refresh commits rotated credentials before reporting failure", async () => {
  const { options, connect, advance, store } = setup();
  await connect();
  advance(3_600_001);
  const service = createConnectionService({ ...options, fetchImpl: async (url, init) => {
    if (String(url).endsWith("/token")) return options.fetchImpl(url, init);
    return Response.json({ error: "temporarily unavailable" }, { status: 503 });
  } });
  await assert.rejects(service.invoke({ context: owner, integrationId: "calendar", operation: "events.list" }), { statusCode: 502 });
  assert.equal([...store.connections.values()][0].tokens.refreshToken, "rotated-refresh-token");
});

test("an invalid refresh grant commits reconnect state rather than rolling it back", async () => {
  const { options, connect, advance } = setup();
  await connect();
  advance(3_600_001);
  const service = createConnectionService({ ...options, fetchImpl: async () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
  await assert.rejects(service.invoke({ context: owner, integrationId: "calendar", operation: "events.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status({ context: owner, integrationId: "calendar" })).status, "reconnect-required");
});

test("removing a local connection does not send a provider-wide revocation", async () => {
  const { service, connect, requests } = setup();
  await connect();
  const count = requests.length;
  assert.deepEqual(await service.disconnect({ context: owner, integrationId: "calendar" }), { status: "disconnected" });
  assert.equal(requests.length, count);
  await assert.rejects(service.invoke({ context: owner, integrationId: "calendar", operation: "events.list" }), { code: "connector_reconnect_required" });
});

test("cancelling consent preserves an existing connection and prevents late completion", async () => {
  const { service, connect, requests } = setup();
  await connect();
  const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  await service.cancelAuthorization({ context: owner, integrationId: "calendar", state });
  const count = requests.length;
  await assert.rejects(service.completeAuthorization({
    context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=x&state=${state}`
  }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, count);
  assert.equal((await service.status({ context: owner, integrationId: "calendar" })).status, "connected");
});

test("invalid operation input remains a field error and never reaches the provider", async () => {
  const { service, connect, requests } = setup();
  await connect();
  const count = requests.length;
  await assert.rejects(service.invoke({
    context: owner, integrationId: "calendar", operation: "events.list", input: { maxResults: -1 }
  }), (error) => {
    assert.equal(error.code, "connector_input_invalid");
    assert.ok(error.fieldErrors.maxResults);
    return true;
  });
  assert.equal(requests.length, count);
});

test("saved grants cannot override permissions removed from application source", async () => {
  const { options, connect } = setup();
  await connect();
  const config = configuration();
  config.integrations.calendar.scopes = [listScope];
  const service = createConnectionService({ ...options, configuration: config });
  await assert.rejects(service.invoke({ context: owner, integrationId: "calendar", operation: "events.list" }), { code: "connector_scope_missing" });
});

test("a changed client registration is immediately reported as needing reconnection", async () => {
  const { options, connect } = setup();
  await connect();
  const config = configuration();
  config.registrations.google.clientId = "another-client";
  const service = createConnectionService({ ...options, configuration: config });
  assert.equal((await service.status({ context: owner, integrationId: "calendar" })).status, "reconnect-required");
});

test("remote field errors cannot smuggle provider response text into application errors", async () => {
  const { options } = setup();
  const service = createConnectionService({ ...options, fetchImpl: async (url, init) => {
    if (String(url).endsWith("/token")) return options.fetchImpl(url, init);
    return Response.json({ error: "failure", fieldErrors: { token: "never-return-this-secret" } }, { status: 422 });
  } });
  const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  await assert.rejects(service.completeAuthorization({ context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=x&state=${state}` }), (error) => {
    assert.equal(error.code, "connector_provider_failed");
    assert.equal(JSON.stringify(error).includes("never-return-this-secret"), false);
    return true;
  });
});

test("a successful HTTP status with an unexpected payload does not verify a connection", async () => {
  const { options } = setup();
  const service = createConnectionService({ ...options, fetchImpl: async (url, init) => {
    if (String(url).endsWith("/token")) return options.fetchImpl(url, init);
    return Response.json({ message: "not a Calendar response" });
  } });
  const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  await assert.rejects(service.completeAuthorization({
    context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=x&state=${state}`
  }), { code: "connector_response_invalid" });
});

test("configuration rejects gateway registrations before constructing a runtime", () => {
  const config = configuration();
  config.registrations.google.source = "managed";
  assert.throws(() => setup({ config }), (error) => Boolean(error.fieldErrors["registrations.google.source"]));
  for (const field of ["serviceUrlRef", "serviceCredentialRef", "assignmentRef"]) {
    const input = configuration();
    input.registrations.google[field] = "env:OBSOLETE_GATEWAY";
    assert.throws(() => validateIntegrationConfiguration(input, { providers: [googleCalendarProvider] }),
      { code: "integration_configuration_invalid" });
  }
});

test("the Feature exposes ordinary JSKIT actions with application authorization", async () => {
  const { options } = setup();
  let actions;
  const runtime = createCapabilityRuntime({ providers: [
    createActionProvider(), createConnectorsFeature(options),
    defineProvider({
      id: "test.observer", requires: { catalogue: "runtime.actions" },
      setup({ catalogue }) { actions = catalogue; }
    })
  ] });
  await runtime.start();
  try {
    await assert.rejects(actions.execute({
      actionId: "connectors.status", input: { integrationId: "calendar" }, context: { channel: "api", surface: "app" }
    }), { code: "connector_access_denied" });
    assert.deepEqual(await actions.execute({
      actionId: "connectors.status", input: { integrationId: "calendar" }, context: { ...owner, channel: "api", surface: "app" }
    }), { status: "disconnected", callbackUrl: callback });
  } finally { await runtime.shutdown(); }
});

test("disconnect invalidates pending consent, including a callback racing with disconnect", async () => {
  const { service, connect, requests } = setup();
  await connect();
  const start = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  await service.disconnect({ context: owner, integrationId: "calendar" });
  const count = requests.length;
  await assert.rejects(service.completeAuthorization({
    context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=x&state=${state}`
  }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, count);

  const next = await service.beginAuthorization({ context: owner, integrationId: "calendar" });
  const nextState = new URL(next.authorizationUrl).searchParams.get("state");
  const completion = service.completeAuthorization({ context: owner, integrationId: "calendar", callbackUrl: `${callback}?code=x&state=${nextState}` });
  const removal = service.disconnect({ context: owner, integrationId: "calendar" });
  await Promise.allSettled([completion, removal]);
  assert.equal((await service.status({ context: owner, integrationId: "calendar" })).status, "disconnected");
});

test("query credentials are encoded, replace URL values and never escape through destinations or errors", async () => {
  const secret = "fixture secret +&?=#/%";
  let destination = "https://api.example.test/items?token=untrusted&token=duplicate&page=2";
  let failing = false;
  const requests = [];
  const provider = {
    id: "query-service", accountModes: ["shared"], authenticationMethods: ["api-key"], scopes: [],
    apiOrigins: ["https://api.example.test"], apiKey: { queryParameter: "token" }, checkOperation: "items.list",
    operations: { "items.list": { scopes: [], request: () => ({ method: "GET", url: destination }) } }
  };
  const store = memoryStore();
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: {
      source: { provider: provider.id, accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:QUERY_KEY" } }
    } },
    providers: [provider], store, authorize: async (context) => context, resolveReference: async () => secret,
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), headers: new Headers(init.headers), init });
      if (failing) throw new Error(`Connection failed at ${url}`);
      return Response.json({ items: [] });
    }
  });
  const input = { context: owner, integrationId: "source" };
  const connected = await service.connectApiKey(input);
  assert.deepEqual(requests[0].url.searchParams.getAll("token"), [secret]);
  assert.equal(requests[0].url.searchParams.get("page"), "2");
  assert.equal(requests[0].headers.has("authorization"), false);
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(JSON.stringify(connected).includes(secret), false);
  assert.equal(JSON.stringify([...store.connections]).includes(secret), false);
  failing = true;
  await assert.rejects(service.invoke({ ...input, operation: "items.list" }), (error) => {
    assert.equal(error.code, "connector_provider_failed");
    assert.equal(error.cause, undefined);
    assert.equal(error.message.includes("token="), false);
    assert.equal(error.stack.includes("token="), false);
    return true;
  });
  const count = requests.length;
  for (const url of ["https://attacker.invalid/items", "http://api.example.test/items", "https://user:password@api.example.test/items"]) {
    destination = url;
    await assert.rejects(service.invoke({ ...input, operation: "items.list" }), { code: "connector_destination_invalid" });
  }
  assert.equal(requests.length, count);
});

test("path credentials preserve the validated origin and query without leaking through storage or errors", async () => {
  const secret = "fixture token /+&?=#%";
  let destination = "https://api.example.test/items?page=2";
  let prefix;
  let prefixCalls = 0;
  let failing = false;
  const requests = [];
  const provider = {
    id: "path-service", accountModes: ["shared"], authenticationMethods: ["api-key"], scopes: [],
    apiOrigins: ["https://api.example.test"], apiKey: { pathPrefix(key) {
      prefixCalls++;
      return prefix === undefined ? `/api/v1/${encodeURIComponent(key)}` : prefix;
    } }, checkOperation: "items.list",
    operations: { "items.list": { scopes: [], request: () => ({ method: "GET", url: destination }) } }
  };
  const store = memoryStore();
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: {
      source: { provider: provider.id, accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:PATH_KEY" } }
    } },
    providers: [provider], store, authorize: async (context) => context, resolveReference: async () => secret,
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      if (failing) throw new Error(`Connection failed at ${url}`);
      return Response.json({ items: [] });
    }
  });
  const input = { context: owner, integrationId: "source" };
  const connected = await service.connectApiKey(input);
  assert.equal(requests[0].url.origin, "https://api.example.test");
  assert.equal(requests[0].url.pathname, "/api/v1/fixture%20token%20%2F%2B%26%3F%3D%23%25/items");
  assert.equal(requests[0].url.search, "?page=2");
  assert.equal(new Headers(requests[0].init.headers).has("authorization"), false);
  assert.equal(requests[0].init.redirect, "error");
  for (const value of [connected, [...store.connections]]) {
    assert.equal(JSON.stringify(value).includes(secret), false);
    assert.equal(JSON.stringify(value).includes(encodeURIComponent(secret)), false);
  }
  for (const url of ["https://attacker.invalid/items", "http://api.example.test/items", "https://user:password@api.example.test/items"]) {
    destination = url;
    await assert.rejects(service.invoke({ ...input, operation: "items.list" }), { code: "connector_destination_invalid" });
  }
  assert.equal(prefixCalls, 1);
  destination = "https://api.example.test/items?page=2";
  for (const invalid of [null, 1, "relative", "//attacker.invalid", "/api/../key", "/api/%2E./key", "/api/./key", "/key?override", "/key#fragment", "/key\\other"]) {
    prefix = invalid;
    await assert.rejects(service.invoke({ ...input, operation: "items.list" }), { code: "connector_request_invalid" });
  }
  assert.equal(requests.length, 1);
  prefix = undefined;
  failing = true;
  await assert.rejects(service.invoke({ ...input, operation: "items.list" }), (error) => {
    assert.equal(error.code, "connector_provider_failed");
    assert.equal(error.cause, undefined);
    assert.equal(error.stack.includes(secret), false);
    assert.equal(error.stack.includes(encodeURIComponent(secret)), false);
    return true;
  });
});

test("JSON-body credentials replace supplied values, preserve input and reach the ordinary verification action", async () => {
  const secret = "fixture body token +&?";
  const originalBody = { api_key: "untrusted", nested: { keep: true } };
  let destination = "https://api.example.test/check";
  let body = originalBody;
  let failing = false;
  const requests = [];
  const provider = {
    id: "body-service", accountModes: ["shared"], authenticationMethods: ["api-key"], scopes: [],
    apiOrigins: ["https://api.example.test"], apiKey: { bodyParameter: "api_key" }, checkOperation: "check",
    operations: { check: { scopes: [], request: (input) => ({ method: "POST", url: destination, body: body === originalBody ? { ...body, subject: input.subject } : body }) } }
  };
  const store = memoryStore();
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: {
      source: { provider: provider.id, accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:BODY_KEY" } }
    } },
    providers: [provider], store, authorize: async (context) => context, resolveReference: async () => secret,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (failing) throw new Error(`Request body contained ${init.body}`);
      return Response.json({ accepted: true });
    }
  };
  let actions;
  const runtime = createCapabilityRuntime({ providers: [
    createActionProvider(), createConnectorsFeature(options),
    defineProvider({ id: "test.body-observer", requires: { catalogue: "runtime.actions" }, setup({ catalogue }) { actions = catalogue; } })
  ] });
  await runtime.start();
  try {
    const result = await actions.execute({ actionId: "connectors.verifyApiKey", input: {
      integrationId: "source", verificationInput: { subject: "verification-user" }
    }, context: { ...owner, channel: "api", surface: "app" } });
    assert.equal(result.status, "connected");
    assert.deepEqual(JSON.parse(requests[0].init.body), { api_key: secret, nested: { keep: true }, subject: "verification-user" });
    assert.deepEqual(originalBody, { api_key: "untrusted", nested: { keep: true } });
    assert.equal(new Headers(requests[0].init.headers).has("authorization"), false);
    assert.equal(new URL(requests[0].url).search, "");
    assert.equal(JSON.stringify([...store.connections]).includes(secret), false);
    assert.equal(JSON.stringify([...store.connections]).includes("verification-user"), false);
    const service = createConnectionService(options);
    const input = { context: owner, integrationId: "source", operation: "check" };
    for (const invalidBody of [undefined, null, [], "plain text"]) {
      body = invalidBody;
      await assert.rejects(service.invoke(input), { code: "connector_request_invalid" });
    }
    assert.equal(requests.length, 1);
    body = originalBody;
    destination = "https://attacker.invalid/check";
    await assert.rejects(service.invoke(input), { code: "connector_destination_invalid" });
    assert.equal(requests.length, 1);
    destination = "https://api.example.test/check";
    failing = true;
    await assert.rejects(service.invoke(input), (error) => {
      assert.equal(error.code, "connector_provider_failed");
      assert.equal(error.cause, undefined);
      assert.equal(error.stack.includes(secret), false);
      return true;
    });
  } finally { await runtime.shutdown(); }
});

for (const [provider, response] of [
  [resendProvider, { object: "list", has_more: true, data: [{ id: "domain-1", status: "verified" }] }],
  [firecrawlProvider, { success: true, data: { remainingCredits: 1000 } }]
]) {
  function apiFixture() {
    const config = {
      schemaVersion: 1, registrations: {}, integrations: { service: {
        provider: provider.id, accountMode: "shared", scopes: [],
        authentication: { method: "api-key", secretRef: "env:SERVICE_KEY" }
      } }
    };
    const store = memoryStore();
    const requests = [];
    const state = { status: 200, response, key: "test-private-key" };
    const options = {
      configuration: config, providers: [provider], store, authorize: async (context) => context,
      resolveReference: async () => state.key,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json(state.response, { status: state.status });
      }
    };
    return { config, options, store, requests, state, service: createConnectionService(options) };
  }

  test(`${provider.id}: API key verification, rotation, isolation and disconnect`, async () => {
    const { service, store, requests, state } = apiFixture();
    const input = { context: owner, integrationId: "service" };
    await assert.rejects(service.invoke({ ...input, operation: provider.checkOperation }), { code: "connector_reconnect_required" });
    const result = await service.connectApiKey(input);
    assert.equal(result.status, "connected");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.method, "GET");
    assert.equal(new Headers(requests[0].init.headers).get("authorization"), "Bearer test-private-key");
    assert.equal(requests[0].init.redirect, "error");
    assert.equal(JSON.stringify([...store.connections]).includes(state.key), false);
    assert.equal(JSON.stringify(result).includes(state.key), false);
    for (const context of [null, { ...owner, subjectId: "someone-else" }, { ...owner, applicationId: "other-app" }]) {
      await assert.rejects(service.invoke({ context, integrationId: "service", operation: provider.checkOperation }));
    }
    assert.equal(requests.length, 1);
    assert.equal((await service.status(input)).status, "connected");
    state.key = "rotated-key";
    assert.equal((await service.status(input)).status, "reconnect-required");
    assert.equal(requests.length, 1);
    assert.deepEqual(await service.invoke({ ...input, operation: provider.checkOperation }), response);
    assert.equal(new Headers(requests[1].init.headers).get("authorization"), "Bearer rotated-key");
    assert.equal((await service.status(input)).status, "connected");
    await service.disconnect(input);
    await assert.rejects(service.invoke({ ...input, operation: provider.checkOperation }), { code: "connector_reconnect_required" });
    assert.equal(requests.length, 2);
  });

  test(`${provider.id}: an unverified replacement key cannot inherit verified status`, async () => {
    const { service, state, requests, options, store } = apiFixture();
    const input = { context: owner, integrationId: "service" };
    await service.connectApiKey(input);
    const original = state.key;
    state.key = "unverified-replacement";
    const reopened = createConnectionService(options);
    assert.equal((await reopened.status(input)).status, "reconnect-required");
    assert.equal(requests.length, 1);
    state.status = 403;
    await assert.rejects(reopened.connectApiKey(input), { code: "connector_permission_denied" });
    assert.equal((await reopened.status(input)).status, "reconnect-required");
    state.key = original;
    assert.equal((await reopened.status(input)).status, "connected");
    state.key = "verified-replacement";
    state.status = 200;
    const connected = await reopened.connectApiKey(input);
    assert.equal((await reopened.status(input)).status, "connected");
    assert.equal(JSON.stringify(connected).includes("credentialFingerprint"), false);
    assert.equal(JSON.stringify([...store.connections]).includes(state.key), false);
  });

  test(`${provider.id}: failures never claim connected or expose provider secrets`, async () => {
    const { service, state, requests } = apiFixture();
    const input = { context: owner, integrationId: "service" };
    for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
      state.status = status;
      state.response = { message: state.key };
      await assert.rejects(service.connectApiKey(input), (error) => {
        assert.equal(error.code, code);
        assert.equal(JSON.stringify(error).includes(state.key), false);
        return true;
      });
      assert.equal((await service.status(input)).status, "disconnected");
    }
    state.status = 200;
    await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
    state.key = "";
    const before = requests.length;
    await assert.rejects(service.connectApiKey(input), { code: "connector_binding_missing" });
    assert.equal(requests.length, before);
  });

  test(`${provider.id}: configuration changes and rejected keys require reconnection`, async () => {
    const { service, options, config, state } = apiFixture();
    const input = { context: owner, integrationId: "service" };
    await service.connectApiKey(input);
    config.integrations.service.authentication.secretRef = "env:DIFFERENT_KEY";
    const changed = createConnectionService(options);
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: provider.checkOperation }), { code: "connector_reconnect_required" });
    state.status = 401;
    await assert.rejects(service.invoke({ ...input, operation: provider.checkOperation }), { code: "connector_reconnect_required" });
    assert.equal((await service.status(input)).status, "reconnect-required");
  });

  test(`${provider.id}: useful operation validates inputs and preserves provider pagination/results`, async () => {
    const { service, requests, state } = apiFixture();
    const input = { context: owner, integrationId: "service" };
    await service.connectApiKey(input);
    if (provider.id === "resend") {
      const result = await service.invoke({ ...input, operation: "domains.list", input: { limit: 7, after: "id & next" } });
      assert.equal(result.has_more, true);
      const url = new URL(requests.at(-1).url);
      assert.equal(url.origin, "https://api.resend.com");
      assert.equal(url.searchParams.get("after"), "id & next");
      assert.equal(url.searchParams.get("limit"), "7");
      await assert.rejects(service.invoke({ ...input, operation: "domains.list", input: { limit: 101 } }), { code: "connector_input_invalid" });
    } else {
      state.response = { success: true, data: { markdown: "# Result", metadata: { title: "Example" } } };
      const result = await service.invoke({ ...input, operation: "pages.scrape", input: { url: "https://example.com/article" } });
      assert.equal(result.data.markdown, "# Result");
      assert.equal(requests.at(-1).url, "https://api.firecrawl.dev/v2/scrape");
      assert.equal(requests.at(-1).init.method, "POST");
      assert.deepEqual(JSON.parse(requests.at(-1).init.body), { url: "https://example.com/article", onlyMainContent: true, formats: ["markdown"] });
      await assert.rejects(service.invoke({ ...input, operation: "pages.scrape", input: { url: "file:///etc/passwd" } }), { code: "connector_input_invalid" });
    }
    assert.equal(requests.length, 2);
    await assert.rejects(service.invoke({ ...input, operation: "unknown" }), { code: "connector_operation_unknown" });
    assert.equal(requests.length, 2);
  });
}

test("public OAuth registrations require provider support and reject secrets", () => {
  const config = configuration();
  const registration = config.registrations.google;
  registration.tokenEndpointAuthMethod = "none";
  delete registration.clientSecretRef;
  assert.throws(() => validateIntegrationConfiguration(config, { providers: [googleCalendarProvider] }), (error) => Boolean(error.fieldErrors["registrations.google.tokenEndpointAuthMethod"]));
  const provider = { ...googleCalendarProvider, oauthClientAuthenticationMethods: ["client_secret_post", "none"] };
  assert.deepEqual(validateIntegrationConfiguration(config, { providers: [provider] }), config);
  registration.clientSecretRef = "env:UNUSED_SECRET";
  assert.throws(() => validateIntegrationConfiguration(config, { providers: [provider] }), (error) => Boolean(error.fieldErrors["registrations.google.clientSecretRef"]));
  delete registration.clientSecretRef;
});

test("changing client authentication invalidates OAuth attempts and stored grants before any exchange", async () => {
  const { service, connect, options, requests } = setup();
  const input = { context: owner, integrationId: "calendar" };
  const start = await service.beginAuthorization(input);
  await connect();
  const config = configuration();
  config.registrations.google.tokenEndpointAuthMethod = "none";
  delete config.registrations.google.clientSecretRef;
  const provider = { ...googleCalendarProvider, oauthClientAuthenticationMethods: ["client_secret_post", "none"] };
  const changed = createConnectionService({ ...options, configuration: config, providers: [provider] });
  const count = requests.length;
  assert.equal((await changed.status(input)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...input, operation: googleCalendarProvider.checkOperation }), { code: "connector_reconnect_required" });
  await assert.rejects(changed.completeAuthorization({ ...input,
    callbackUrl: `${callback}?code=x&state=${new URL(start.authorizationUrl).searchParams.get("state")}` }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, count);
});


test("placeholder environment bindings fail without exposing values", async () => {
  for (const value of [undefined, "", "  ", "MISSING", " MISSING "]) {
    const resolve = createEnvironmentReferenceResolver({ KEY: value });
    await assert.rejects(resolve("env:KEY"), { code: "connector_binding_missing" });
  }
  assert.equal(await createEnvironmentReferenceResolver({ KEY: "real-value" })("env:KEY"), "real-value");
});

test("OAuth placeholders from custom resolvers never create consent attempts", async () => {
  for (const value of [undefined, "", "  ", "MISSING", " MISSING "]) {
    const store = memoryStore();
    let attempts = 0;
    store.saveAttempt = async () => { attempts++; };
    const service = createConnectionService({
      configuration: configuration(), providers: [googleCalendarProvider], store,
      authorize: async () => owner,
      resolveReference: async (reference) => reference === "env:CALLBACK" ? callback : value,
      fetchImpl: async () => { assert.fail("No provider request is permitted."); }
    });
    await assert.rejects(service.beginAuthorization({ context: owner, integrationId: "calendar" }), { code: "connector_binding_missing" });
    assert.equal(attempts, 0);
  }
  const config = configuration();
  config.registrations.google.clientId = "MISSING";
  const service = createConnectionService({ configuration: config, providers: [googleCalendarProvider], store: memoryStore(),
    authorize: async () => owner, resolveReference: async () => { assert.fail("No binding resolution is needed."); } });
  await assert.rejects(service.beginAuthorization({ context: owner, integrationId: "calendar" }), { code: "connector_binding_missing" });
});

test("API-key placeholders from custom resolvers never reach the provider", async () => {
  const config = { schemaVersion: 1, registrations: {}, integrations: { mail: {
    provider: "resend", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:KEY" }
  } } };
  const service = createConnectionService({ configuration: config, providers: [resendProvider], store: memoryStore(),
    authorize: async () => owner, resolveReference: async () => "MISSING",
    fetchImpl: async () => { assert.fail("No placeholder may be sent to the provider."); } });
  await assert.rejects(service.connectApiKey({ context: owner, integrationId: "mail" }), { code: "connector_binding_missing" });
  assert.deepEqual(await service.status({ context: owner, integrationId: "mail" }), { status: "unconfigured", configurationError: "connector_binding_missing" });
});


test("missing OAuth credentials keep an existing grant visible and removable without provider traffic", async () => {
  const fixture = setup();
  await fixture.connect();
  const count = fixture.requests.length;
  const service = createConnectionService({ ...fixture.options,
    resolveReference: async (reference) => reference === "env:CALLBACK" ? callback : "MISSING" });
  const input = { context: owner, integrationId: "calendar" };
  assert.equal((await service.status(input)).status, "reconnect-required");
  assert.equal((await fixture.service.status(input)).status, "connected");
  assert.equal(fixture.requests.length, count);
  await service.disconnect(input);
  assert.deepEqual(await service.status(input), { status: "unconfigured", configurationError: "connector_binding_missing" });
  assert.equal(fixture.requests.length, count);
});

test("missing API key preserves a verified connection until explicit disconnect", async () => {
  let key = "fixture-key";
  let requests = 0;
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { mail: {
      provider: "resend", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:KEY" }
    } } }, providers: [resendProvider], store: memoryStore(), authorize: async () => owner,
    resolveReference: async () => key,
    fetchImpl: async () => { requests++; return Response.json({ object: "list", data: [], has_more: false }); }
  });
  const input = { context: owner, integrationId: "mail" };
  await service.connectApiKey(input);
  key = "MISSING";
  assert.equal((await service.status(input)).status, "reconnect-required");
  assert.equal(requests, 1);
  key = "fixture-key";
  assert.equal((await service.status(input)).status, "connected");
  key = "";
  await service.disconnect(input);
  assert.deepEqual(await service.status(input), { status: "unconfigured", configurationError: "connector_binding_missing" });
  assert.equal(requests, 1);
});
