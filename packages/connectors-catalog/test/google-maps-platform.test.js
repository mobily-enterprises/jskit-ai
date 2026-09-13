import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { googleMapsPlatformProvider } from "../src/server/google-maps-platform.js";

const context = { applicationId: "app-one", subjectId: "team-one" };
const input = { context, integrationId: "maps" };
const verificationInput = { address: "Perth WA, Australia" };
const places = { status: "OK", results: [{ formatted_address: "Perth WA, Australia", place_id: "fixture-place",
  geometry: { location: { lat: -31.95, lng: 115.86 } }, address_components: [], types: ["locality"], partial_match: true }] };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "google-maps-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" });
  const requests = [];
  const state = { key: "fixture-server-key", status: 200, response: places };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: {
      maps: { provider: "google-maps-platform", accountMode: "shared", scopes: [],
        authentication: { method: "api-key", secretRef: "env:GOOGLE_MAPS_SERVER_KEY" },
        settings: { browserKeyRef: "env:GOOGLE_MAPS_BROWSER_KEY" } }
    }, extensions: { fromCli: true } },
    providers: [googleMapsPlatformProvider], authorize: async (owner) => owner,
    resolveReference: async (ref) => {
      assert.equal(ref, "env:GOOGLE_MAPS_SERVER_KEY", "The optional browser key must never be resolved by backend operations.");
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

test("Google Maps verification requires an explicit address and saves only references across restart", async (t) => {
  assert.deepEqual(googleMapsPlatformProvider.verificationFields.filter((field) => field.required).map((field) => field.name), Object.keys(verificationInput));
  const { service, options, directory, protection, requests, state } = await fixture(t);
  await assert.rejects(service.connectApiKey(input), { code: "connector_input_invalid" });
  assert.equal(requests.length, 0);
  assert.equal((await service.status(input)).status, "disconnected");
  const connected = await service.connectApiKey({ ...input, verificationInput });
  assert.equal(connected.status, "connected");
  assert.equal(requests[0].url.origin, "https://maps.googleapis.com");
  assert.equal(requests[0].url.pathname, "/maps/api/geocode/json");
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { ...verificationInput, key: state.key });
  assert.equal(requests[0].headers.has("referer"), false);
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(JSON.stringify(connected).includes(state.key), false);
  for (const name of await readdir(directory)) assert.equal((await readFile(path.join(directory, name), "utf8")).includes(state.key), false);
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connected);
  state.key = "replacement-server-key";
  assert.deepEqual(await restarted.invoke({ ...input, operation: "geocoding.forward", input: verificationInput }), places);
  assert.equal(requests.at(-1).url.searchParams.get("key"), state.key);
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "geocoding.forward", input: verificationInput }), { code: "connector_reconnect_required" });
  }
  assert.equal(requests.length, 2);
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Google Maps keeps optional browser configuration portable and requires verification after changes", async (t) => {
  const { service, options, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [googleMapsPlatformProvider] });
  assert.deepEqual(parse(options.configuration), options.configuration);
  const changed = structuredClone(options.configuration);
  changed.integrations.maps.settings.browserKeyRef = "raw-browser-key";
  assert.throws(() => parse(changed), (error) => Boolean(error.fieldErrors["integrations.maps.settings.browserKeyRef"]));
  delete changed.integrations.maps.settings.browserKeyRef;
  assert.deepEqual(parse(changed), changed);
  await service.connectApiKey({ ...input, verificationInput });
  const replacement = createConnectionService({ ...options, configuration: changed });
  assert.equal((await replacement.status(input)).status, "reconnect-required");
  await assert.rejects(replacement.invoke({ ...input, operation: "geocoding.forward", input: verificationInput }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, 1);
  await replacement.connectApiKey({ ...input, verificationInput });
  assert.equal((await replacement.status(input)).status, "connected");
});

test("Google Maps preserves geocoding results, plus codes, language and legitimate empty results", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey({ ...input, verificationInput });
  const query = { address: "849VCWC8+R9 & Café", language: "pt-BR", region: "au" };
  assert.deepEqual(await service.invoke({ ...input, operation: "geocoding.forward", input: query }), places);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { ...query, key: state.key });
  assert.ok(requests.at(-1).url.href.includes("%2B"));
  assert.deepEqual(await service.invoke({ ...input, operation: "geocoding.reverse", input: { latitude: -31.95, longitude: 115.86, language: "en" } }), places);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { latlng: "-31.95,115.86", language: "en", key: state.key });
  state.response = { status: "ZERO_RESULTS", results: [] };
  assert.deepEqual(await service.invoke({ ...input, operation: "geocoding.reverse", input: { latitude: 90, longitude: -180 } }), state.response);
  assert.equal((await service.connectApiKey({ ...input, verificationInput })).status, "connected");
  assert.equal(requests.length, 5);
});

test("Google Maps rejects invalid inputs before transport without accepting key or destination overrides", async (t) => {
  const { service, requests } = await fixture(t);
  await service.connectApiKey({ ...input, verificationInput });
  for (const query of [{}, { address: "" }, { address: "   " }, { address: "x".repeat(1001) },
    { ...verificationInput, language: "en&key=other" }, { ...verificationInput, region: "a1" },
    { ...verificationInput, key: "other" }, { ...verificationInput, url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "geocoding.forward", input: query }), { code: "connector_input_invalid" });
  }
  for (const query of [{}, { latitude: 0 }, { longitude: 0 }, { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 }, { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity },
    { latitude: 0, longitude: 0, latlng: "10,20" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "geocoding.reverse", input: query }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 1);
});

test("Google Maps treats HTTP-200 provider errors as failures without guessing ambiguous billing or key causes", async (t) => {
  const { service, state } = await fixture(t);
  for (const [status, code] of [["OVER_QUERY_LIMIT", "connector_rate_limited"], ["OVER_DAILY_LIMIT", "connector_configuration_invalid"],
    ["REQUEST_DENIED", "connector_permission_denied"], ["INVALID_REQUEST", "connector_input_invalid"], ["UNKNOWN_ERROR", "connector_provider_failed"]]) {
    state.response = { status, results: [], error_message: `Diagnostic contains ${state.key}` };
    await assert.rejects(service.connectApiKey({ ...input, verificationInput }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stack.includes(state.key), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  for (const response of [{}, { status: "unexpected", results: [] }, { status: "OK", results: [] },
    { status: "ZERO_RESULTS", results: places.results }, { status: "OK", results: [{}] },
    { status: "OK", results: [{ ...places.results[0], geometry: { location: { lat: 91, lng: 0 } } }] }]) {
    state.response = response;
    await assert.rejects(service.connectApiKey({ ...input, verificationInput }), { code: "connector_response_invalid" });
  }
});

test("Google Maps transport errors preserve safe failure categories and revoked connections require reconnecting", async (t) => {
  const { service, state } = await fixture(t);
  await service.connectApiKey({ ...input, verificationInput });
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"], [401, "connector_reconnect_required"]]) {
    state.status = status;
    state.response = { error_message: state.key };
    await assert.rejects(service.invoke({ ...input, operation: "geocoding.forward", input: verificationInput }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stack.includes(state.key), false);
      return true;
    });
  }
  assert.equal((await service.status(input)).status, "reconnect-required");
});


test("Maps Places and Routes use bounded inputs, billing masks and only the server key", async t => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey({ ...input, verificationInput });
  const invoke = (operation, body) => service.invoke({ ...input, operation, input: body });
  state.response = { places: [{ id: "place-one", displayName: { text: "Dog groomer" }, location: { latitude: -31.95, longitude: 115.86 } }], nextPageToken: "opaque" };
  assert.equal((await invoke("places.search", { textQuery: "dog groomers Perth", pageToken: "prior" })).nextPageToken, "opaque");
  let request = requests.at(-1);
  assert.equal(request.url.href, "https://places.googleapis.com/v1/places:searchText");
  assert.equal(request.headers.get("x-goog-api-key"), state.key); assert.equal(request.url.searchParams.has("key"), false);
  assert.equal(request.headers.get("x-goog-fieldmask").includes("*"), false);
  assert.equal(request.headers.get("x-goog-fieldmask").includes("places.attributions"), true);
  assert.deepEqual(JSON.parse(request.init.body), { textQuery: "dog groomers Perth", pageSize: 10, pageToken: "prior" });
  state.response = { id: "place-one" };
  await invoke("places.get", { placeId: "place-one" });
  assert.equal(requests.at(-1).url.pathname, "/v1/places/place-one");
  const routeInput = { originLatitude: -31.95, originLongitude: 115.86, destinationLatitude: -31.96, destinationLongitude: 115.87, travelMode: "WALK" };
  state.response = { routes: [{ duration: "120s", distanceMeters: 400, polyline: { geoJsonLinestring: { type: "LineString", coordinates: [[115.86, -31.95], [115.87, -31.96]] } } }] };
  assert.equal((await invoke("routes.compute", routeInput)).routes[0].distanceMeters, 400);
  request = requests.at(-1);
  assert.equal(request.url.href, "https://routes.googleapis.com/directions/v2:computeRoutes");
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.origin.location.latLng, { latitude: -31.95, longitude: 115.86 });
  assert.equal(body.polylineEncoding, "GEO_JSON_LINESTRING"); assert.equal(body.travelMode, "WALK");
  state.response = {}; assert.deepEqual(await invoke("routes.compute", routeInput), {});
  const before = requests.length;
  await assert.rejects(invoke("routes.compute", { ...routeInput, destinationLatitude: 91 }));
  await assert.rejects(invoke("places.get", { placeId: "../keys" }));
  await assert.rejects(invoke("places.search", { textQuery: "Perth", pageSize: 21 }));
  assert.equal(requests.length, before);
  state.status = 403;
  await assert.rejects(invoke("places.search", { textQuery: "Perth" }), { code: "connector_permission_denied" });
  state.status = 429;
  await assert.rejects(invoke("routes.compute", routeInput), { code: "connector_rate_limited" });
  assert.equal(requests.length, before + 2);
});
