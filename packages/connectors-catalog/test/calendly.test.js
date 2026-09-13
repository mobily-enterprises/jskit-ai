import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { calendlyProvider } from "../src/server/calendly.js";

test("Calendly web OAuth uses Basic and PKCE, persists rotating refresh tokens and retains personal-token access", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "calendly-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const callback = "https://example.test/integrations/calendly/callback";
  const context = { applicationId: "app", subjectId: "owner" };
  const input = { context, integrationId: "calendar" };
  let time = Date.now(), exchanges = 0;
  let tokenScope = "users:read event_types:read", apiStatus = 200;
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, registrations: { calendar: { source: "own", clientId: "client", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK", tokenEndpointAuthMethod: "client_secret_basic" } }, integrations: {
      calendar: { provider: "calendly", accountMode: "shared", scopes: ["users:read", "event_types:read"], authentication: { method: "oauth2", registrationRef: "calendar" } },
      personal: { provider: "calendly", accountMode: "shared", scopes: ["users:read", "event_types:read"], authentication: { method: "api-key", secretRef: "env:TOKEN" } }
    } }, providers: [calendlyProvider], authorize: async owner => owner,
    store: createFileConnectionStore({ directory, protection }), now: () => time,
    resolveReference: async ref => ref === "env:CALLBACK" ? callback : ref === "env:TOKEN" ? "personal" : "secret",
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)), headers = new Headers(init.headers);
      if (url.origin === "https://auth.calendly.com") {
        assert.equal(url.pathname, "/oauth/token");
        assert.equal(headers.get("authorization"), "Basic " + Buffer.from("client:secret").toString("base64"));
        const body = new URLSearchParams(init.body);
        assert.equal(body.has("client_secret"), false);
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback);
          assert.ok(body.get("code_verifier"));
        } else assert.equal(body.get("refresh_token"), `refresh-${exchanges}`);
        exchanges++;
        return Response.json({ access_token: `access-${exchanges}`, refresh_token: `refresh-${exchanges}`, token_type: "Bearer", expires_in: 60, scope: tokenScope });
      }
      assert.equal(url.origin, "https://api.calendly.com");
      assert.ok([`Bearer access-${exchanges}`, "Bearer personal"].includes(headers.get("authorization")));
      if (apiStatus !== 200) return Response.json({ message: "private provider detail" }, { status: apiStatus });
      return Response.json({ resource: { uri: "https://api.calendly.com/users/one", name: "Fixture" } });
    }
  };
  const service = createConnectionService(options);
  for (const outcome of ["cancel", "denied"]) {
    const attempt = new URL((await service.beginAuthorization(input)).authorizationUrl);
    const denied = new URL(callback);
    denied.searchParams.set("state", attempt.searchParams.get("state"));
    if (outcome === "cancel") {
      await service.cancelAuthorization({ ...input, state: attempt.searchParams.get("state") });
      denied.searchParams.set("code", "unused");
    } else denied.searchParams.set("error", "access_denied");
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: denied.href }), {
      code: outcome === "cancel" ? "connector_attempt_invalid" : "connector_consent_denied"
    });
  }
  assert.equal(exchanges, 0);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://auth.calendly.com/oauth/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const returned = new URL(callback);
  returned.searchParams.set("code", "code");
  returned.searchParams.set("state", url.searchParams.get("state"));
  assert.equal((await service.completeAuthorization({ ...input, callbackUrl: returned.href })).status, "connected");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: returned.href }), { code: "connector_attempt_invalid" });
  time += 40_000;
  await Promise.all([service.invoke({ ...input, operation: "profile.read" }), service.invoke({ ...input, operation: "profile.read" })]);
  assert.equal(exchanges, 2);
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  time += 40_000;
  await restarted.invoke({ ...input, operation: "profile.read" });
  assert.equal(exchanges, 3);
  assert.equal((await restarted.connectApiKey({ context, integrationId: "personal" })).status, "connected");
  const reconnect = new URL((await restarted.beginAuthorization(input)).authorizationUrl);
  returned.searchParams.set("state", reconnect.searchParams.get("state"));
  tokenScope = "users:read";
  await restarted.completeAuthorization({ ...input, callbackUrl: returned.href });
  await assert.rejects(restarted.invoke({ ...input, operation: "eventTypes.list", input: { user: "https://api.calendly.com/users/one" } }), { code: "connector_scope_missing" });
  apiStatus = 403;
  await assert.rejects(restarted.invoke({ ...input, operation: "profile.read" }), { code: "connector_permission_denied" });
  apiStatus = 401;
  await assert.rejects(restarted.invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  await restarted.disconnect(input);
  assert.equal((await restarted.status(input)).status, "disconnected");
});

test("Calendly scheduling retains booking details, scopes, pagination and explicit write outcomes", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "calendly-scheduling-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = []; const state = { response: { resource: { uri: "https://api.calendly.com/users/u", name: "Owner" } }, status: 200, fail: false, deny: false };
  const identity = { context: { applicationId: "booking", subjectId: "owner" }, integrationId: "calendar" };
  const service = createConnectionService({ configuration: { schemaVersion: 1, registrations: {}, integrations: {
    calendar: { provider: "calendly", accountMode: "shared", scopes: ["users:read", "event_types:read", "availability:read", "scheduled_events:read", "scheduled_events:write", "scheduling_links:write"], authentication: { method: "api-key", secretRef: "env:CALENDLY_API_KEY" } }
  } }, providers: [calendlyProvider], authorize: async context => { if (state.deny) throw new Error("denied"); return context; }, resolveReference: async () => "fixture-token",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, init) => { requests.push({ url: new URL(url), init }); if (state.fail) throw new Error("uncertain booking");
      return state.response === null ? new Response(null, { status: 204 }) : Response.json(state.response, { status: state.status }); }
  });
  await service.connectApiKey(identity);
  const invoke = (operation, input = {}) => service.invoke({ ...identity, operation, input });
  const event_type = "https://api.calendly.com/event_types/type1", event = "https://api.calendly.com/scheduled_events/event1";
  const invitee = { uri: `${event}/invitees/invitee1`, email: "customer@example.test", status: "active", timezone: "Australia/Perth", reschedule_url: "https://calendly.com/reschedulings/fixture", cancel_url: "https://calendly.com/cancellations/fixture", questions_and_answers: [{ question: "Dog name", answer: "Fido", position: 0 }] };
  const booking = { event_type, start_time: "2026-10-01T02:00:00Z", invitee: { email: invitee.email, name: "Sam", timezone: invitee.timezone }, questions_and_answers: invitee.questions_and_answers, event_guests: ["partner@example.test"] };
  for (const [operation, method, endpoint, input, response] of [
    ["eventTypes.get", "GET", "event_types/type1", { uuid: "type1" }, { resource: { uri: event_type, scheduling_url: "https://calendly.com/owner/groom" } }],
    ["availability.list", "GET", "event_type_available_times", { event_type, start_time: booking.start_time, end_time: "2026-10-02T02:00:00Z" }, { collection: [{ start_time: booking.start_time, status: "available", invitees_remaining: 1 }] }],
    ["events.list", "GET", "scheduled_events", { user: "https://api.calendly.com/users/u", count: 1, page_token: "next", status: "active" }, { collection: [{ uri: event, status: "active" }], pagination: { count: 1, next_page_token: "next2" } }],
    ["events.get", "GET", "scheduled_events/event1", { uuid: "event1" }, { resource: { uri: event, status: "active" } }],
    ["invitees.list", "GET", "scheduled_events/event1/invitees", { uuid: "event1", count: 1 }, { collection: [invitee], pagination: { count: 1, next_page_token: null } }],
    ["invitees.get", "GET", "scheduled_events/event1/invitees/invitee1", { uuid: "event1", invitee_uuid: "invitee1" }, { resource: invitee }],
    ["invitees.create", "POST", "invitees", booking, { resource: invitee }],
    ["schedulingLinks.create", "POST", "scheduling_links", { owner: event_type, owner_type: "EventType", max_event_count: 1 }, { resource: { owner: event_type, owner_type: "EventType", booking_url: "https://calendly.com/d/fixture" } }],
    ["events.cancel", "POST", "scheduled_events/event1/cancellation", { uuid: "event1", reason: "Customer requested" }, { resource: { canceled_by: "Owner", created_at: "2026-09-12T00:00:00Z" } }],
    ["noShows.create", "POST", "invitee_no_shows", { invitee: invitee.uri }, { resource: { uri: "https://api.calendly.com/invitee_no_shows/n1", invitee: invitee.uri } }],
    ["noShows.get", "GET", "invitee_no_shows/n1", { uuid: "n1" }, { resource: { uri: "https://api.calendly.com/invitee_no_shows/n1", invitee: invitee.uri } }],
    ["noShows.delete", "DELETE", "invitee_no_shows/n1", { uuid: "n1" }, null]
  ]) { state.response = response; assert.deepEqual(await invoke(operation, input), response);
    const request = requests.at(-1); assert.equal(request.url.origin, "https://api.calendly.com"); assert.equal(request.url.pathname, `/${endpoint}`); assert.equal(request.init.method, method);
    const { uuid, invitee_uuid, ...values } = input;
    if (method === "POST") assert.deepEqual(JSON.parse(request.init.body), values);
    if (method === "GET") for (const [key, value] of Object.entries(values)) assert.equal(request.url.searchParams.get(key), String(value));
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer fixture-token"); assert.equal(request.init.redirect, "error");
  }
  const before = requests.length;
  for (const [operation, input] of [["events.list", {}], ["events.get", { uuid: "../users/me" }],
    ["availability.list", { event_type, start_time: booking.start_time, end_time: "2026-12-01T00:00:00Z" }],
    ["invitees.create", { ...booking, invitee: { ...booking.invitee, timezone: "Not/AZone" } }],
    ["schedulingLinks.create", { owner: "https://evil.test/type", max_event_count: 2 }]]) await assert.rejects(invoke(operation, input));
  state.deny = true; await assert.rejects(invoke("invitees.create", booking)); state.deny = false; assert.equal(requests.length, before);
  state.response = { resource: { message: "No booking" } }; await assert.rejects(invoke("invitees.create", booking), { code: "connector_response_invalid" });
  state.status = 403; await assert.rejects(invoke("invitees.create", booking), { code: "connector_permission_denied" });
  state.status = 429; await assert.rejects(invoke("invitees.create", booking));
  state.status = 200; state.fail = true; const uncertain = requests.length; await assert.rejects(invoke("invitees.create", booking)); assert.equal(requests.length, uncertain + 1);
});
