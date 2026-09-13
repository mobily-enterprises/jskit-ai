import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { mapboxProvider } from "../src/server/mapbox.js";

const context = { applicationId: "app-one", subjectId: "team-one" };
const input = { context, integrationId: "maps" };
const token = { code: "TokenValid", token: { usage: "sk", user: "fixture", authorization: "token-id" } };
const places = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [115.86, -31.95] }, properties: { name: "Perth" } }], attribution: "Fixture attribution" };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "mapbox-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const requests = [];
  const state = { key: "sk.fixture", status: 200, response: token };
  const options = {
    configuration: { schemaVersion: 1, integrations: {
      maps: { provider: "mapbox", accountMode: "shared", scopes: [],
        authentication: { method: "api-key", secretRef: "env:MAPBOX_BACKEND_TOKEN" },
        settings: { usage: "backend", publicTokenRef: "env:MAPBOX_PUBLIC_TOKEN" }, extensions: { keep: true } }
    }, registrations: {}, extensions: { fromCli: true } },
    providers: [mapboxProvider], authorize: async (owner) => owner,
    resolveReference: async (ref) => {
      assert.equal(ref, "env:MAPBOX_BACKEND_TOKEN");
      return state.key;
    },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      return Response.json(state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, directory, protection, requests, state };
}

test("Mapbox verifies an active token, persists only references and isolates application owners", async (t) => {
  const { service, options, directory, protection, requests, state } = await fixture(t);
  const connected = await service.connectApiKey(input);
  assert.equal(connected.status, "connected");
  assert.equal(requests[0].url.href, "https://api.mapbox.com/tokens/v2?access_token=sk.fixture");
  assert.equal(requests[0].headers.has("authorization"), false);
  assert.equal(requests[0].headers.has("referer"), false);
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(JSON.stringify(connected).includes(state.key), false);
  for (const name of await readdir(directory)) assert.equal((await readFile(path.join(directory, name), "utf8")).includes(state.key), false);
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connected);
  state.key = "pk.replacement";
  state.response = { code: "TokenValid", token: { usage: "pk", user: "fixture", authorization: "replacement-id" } };
  assert.deepEqual(await restarted.invoke({ ...input, operation: "token.read" }), state.response);
  assert.equal(requests.at(-1).url.searchParams.get("access_token"), state.key);
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "token.read" }), { code: "connector_reconnect_required" });
  }
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Mapbox keeps browser references separate and re-verifies changed configuration", async (t) => {
  const { options, service, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [mapboxProvider] });
  assert.deepEqual(parse(options.configuration), options.configuration);
  const changed = structuredClone(options.configuration);
  changed.integrations.maps.settings.publicTokenRef = "pk.must-not-be-source";
  assert.throws(() => parse(changed), (error) => Boolean(error.fieldErrors["integrations.maps.settings.publicTokenRef"]));
  delete changed.integrations.maps.settings.publicTokenRef;
  assert.deepEqual(parse(changed), changed);
  await service.connectApiKey(input);
  const replacement = createConnectionService({ ...options, configuration: changed });
  assert.equal((await replacement.status(input)).status, "reconnect-required");
  await assert.rejects(replacement.invoke({ ...input, operation: "token.read" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, 1);
  await replacement.connectApiKey(input);
  assert.equal((await replacement.status(input)).status, "connected");
});

test("Mapbox rejects inactive token replies even with HTTP 200 and persists reconnect state", async (t) => {
  const { service, state } = await fixture(t);
  for (const code of ["TokenMalformed", "TokenInvalid", "TokenExpired", "TokenRevoked"]) {
    state.response = { code, token: { ...token.token, diagnostic: state.key } };
    await assert.rejects(service.connectApiKey(input), { code: "connector_reconnect_required" });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  for (const response of [{ code: "TokenValid" }, { code: "TokenValid", token: { usage: "unknown", user: "x" } }, { code: "TokenValid", token: { usage: "pk" } }, { code: "Unexpected" }]) {
    state.response = response;
    await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
  }
  state.response = token;
  await service.connectApiKey(input);
  state.response = { code: "TokenRevoked", message: state.key };
  await assert.rejects(service.invoke({ ...input, operation: "token.read" }), (error) => {
    assert.equal(error.code, "connector_reconnect_required");
    assert.equal(error.stack.includes(state.key), false);
    return true;
  });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Mapbox geocoding preserves features, attribution and explicit storage intent", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  state.response = places;
  assert.deepEqual(await service.invoke({ ...input, operation: "geocoding.forward", input: { q: "Café & Perth" } }), places);
  assert.equal(requests.at(-1).url.pathname, "/search/geocode/v6/forward");
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { q: "Café & Perth", limit: "5", autocomplete: "false", permanent: "false", access_token: "sk.fixture" });
  await service.invoke({ ...input, operation: "geocoding.forward", input: { q: "Perth", limit: 10, autocomplete: true, permanent: true } });
  assert.equal(requests.at(-1).url.searchParams.get("permanent"), "true");
  assert.deepEqual(await service.invoke({ ...input, operation: "geocoding.reverse", input: { longitude: 115.86, latitude: -31.95 } }), places);
  assert.equal(requests.at(-1).url.pathname, "/search/geocode/v6/reverse");
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { longitude: "115.86", latitude: "-31.95", permanent: "false", access_token: "sk.fixture" });
  state.response = { ...places, features: [] };
  assert.deepEqual(await service.invoke({ ...input, operation: "geocoding.reverse", input: { longitude: -180, latitude: 90 } }), state.response);
  for (const response of [{ type: "FeatureCollection", features: [] }, { ...places, features: {} }, { ...places, type: "Feature" }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "geocoding.forward", input: { q: "Perth" } }), { code: "connector_response_invalid" });
  }
});

test("Mapbox bounds geocoding input before transport and cannot override credentials or URLs", async (t) => {
  const { service, requests } = await fixture(t);
  await service.connectApiKey(input);
  for (const value of [{}, { q: "" }, { q: "x".repeat(257) }, { q: "one ".repeat(21) }, { q: "A;B" }, { q: "Perth", limit: 0 }, { q: "Perth", limit: 11 }, { q: "Perth", limit: 1.5 }, { q: "Perth", autocomplete: "maybe" }, { q: "Perth", permanent: [] }, { q: "Perth", access_token: "other" }, { q: "Perth", url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "geocoding.forward", input: value }), { code: "connector_input_invalid" });
  }
  for (const value of [{}, { longitude: 0 }, { latitude: 0 }, { longitude: 181, latitude: 0 }, { longitude: 0, latitude: -91 }, { longitude: NaN, latitude: 0 }, { longitude: 0, latitude: Infinity }]) {
    await assert.rejects(service.invoke({ ...input, operation: "geocoding.reverse", input: value }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 1);
});

test("Mapbox token verification does not bypass geocoding permission or quota failures", async (t) => {
  const { service, state } = await fixture(t);
  await service.connectApiKey(input);
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"], [401, "connector_reconnect_required"]]) {
    state.status = status;
    state.response = { message: state.key };
    await assert.rejects(service.invoke({ ...input, operation: "geocoding.forward", input: { q: "Perth" } }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stack.includes(state.key), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Mapbox browser-only configuration needs a public reference but no backend credential", () => {
  const configuration = { schemaVersion: 1, registrations: {}, integrations: { maps: {
    provider: "mapbox", accountMode: "shared", scopes: [], authentication: { method: "none" },
    settings: { usage: "browser", publicTokenRef: "env:MAPBOX_PUBLIC_TOKEN" }
  } } };
  const parse = value => parseIntegrationConfiguration(JSON.stringify(value), { providers: [mapboxProvider] });
  assert.deepEqual(parse(configuration), configuration);
  assert.equal(mapboxProvider.configurationOnlyForSettings(configuration.integrations.maps.settings), true);
  delete configuration.integrations.maps.settings.publicTokenRef;
  assert.throws(() => parse(configuration));
});

test("Mapbox directions preserve route geometry and distinguish unavailable routes", async t => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  const values = { profile: "walking", coordinates: [{ longitude: 115.86, latitude: -31.95 }, { longitude: 115.87, latitude: -31.96 }], steps: true };
  state.response = { code: "Ok", routes: [{ distance: 1400, duration: 1100, geometry: { type: "LineString", coordinates: [[115.86, -31.95], [115.87, -31.96]] } }] };
  const call = values => service.invoke({ ...input, operation: "directions.get", input: values });
  assert.deepEqual(await call(values), state.response);
  assert.equal(requests.at(-1).url.pathname, "/directions/v5/mapbox/walking/115.86,-31.95;115.87,-31.96");
  assert.equal(requests.at(-1).url.searchParams.get("geometries"), "geojson");
  for (const code of ["NoRoute", "NoSegment"]) { state.response = { code }; assert.deepEqual(await call(values), { code }); }
  const count = requests.length;
  for (const changes of [{ coordinates: [] }, { profile: "../keys" }, { coordinates: [{ longitude: 181, latitude: 0 }, { longitude: 0, latitude: 0 }] }])
    await assert.rejects(call({ ...values, ...changes }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response = { code: "Ok", routes: [{ distance: -1 }] };
  await assert.rejects(call(values), { code: "connector_response_invalid" });
});
