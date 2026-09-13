import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createLocalAuthService, createLocalFileBackend } from "../../auth-provider-local-core/src/server/lib/index.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { resendProvider } from "../src/server/resend.js";

const context = { applicationId: "mail-app", subjectId: "business-mail" };
const input = { from: "Support <support@example.com>", to: ["person@example.com"],
  subject: "Reset your password", text: "Your application-owned recovery message.\n",
  idempotencyKey: "recovery/fixture-event" };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "resend-send-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { fail: false };
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { mail: {
      provider: "resend", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:RESEND_KEY" }
    } } },
    providers: [resendProvider], authorize: async (owner, request) => state.denied === request.operation ? null : owner,
    resolveReference: async () => "private-fixture-key",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({
      keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current"
    }) }),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      if (new URL(url).pathname === "/domains") return Response.json({ object: "list", data: [], has_more: false });
      if (state.fail) throw new Error("unknown delivery outcome");
      return Response.json(state.response || { id: "fixture-message-id" }, { status: state.status || 200 });
    }
  });
  await service.connectApiKey({ context, integrationId: "mail" });
  return { service, requests, state, directory };
}

test("Resend connection checks do not send; explicit delivery keeps the application's idempotency key", async (t) => {
  const { service, requests } = await fixture(t);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, "/domains");
  assert.equal(requests[0].init.method, "GET");
  const result = await service.invoke({ context, integrationId: "mail", operation: "emails.send", input });
  assert.deepEqual(result, { id: "fixture-message-id" });
  const sent = requests[1];
  assert.equal(sent.url, "https://api.resend.com/emails");
  assert.equal(sent.init.method, "POST");
  assert.equal(new Headers(sent.init.headers).get("idempotency-key"), input.idempotencyKey);
  assert.equal(new Headers(sent.init.headers).get("authorization"), "Bearer private-fixture-key");
  const { idempotencyKey, ...body } = input;
  assert.deepEqual(JSON.parse(sent.init.body), body);
  await assert.rejects(service.invoke({ context: { ...context, applicationId: "other-app" },
    integrationId: "mail", operation: "emails.send", input }));
  assert.equal(requests.length, 2);
});

test("Resend rejects incomplete sending inputs and does not retry an uncertain delivery", async (t) => {
  const { service, requests, state } = await fixture(t);
  for (const invalid of [{ ...input, idempotencyKey: "" }, { ...input, to: [] },
    { ...input, to: Array(51).fill("person@example.com") }, { ...input, to: ["not-an-email"] },
    { ...input, subject: "subject\r\ninjected" }, { ...input, text: "" }]) {
    await assert.rejects(service.invoke({ context, integrationId: "mail", operation: "emails.send", input: invalid }));
  }
  assert.equal(requests.length, 1);
  state.fail = true;
  await assert.rejects(service.invoke({ context, integrationId: "mail", operation: "emails.send", input }));
  assert.equal(requests.length, 2);
});


test("documented application wiring sends auth recovery through the Resend adapter", async (t) => {
  const { service, requests, directory } = await fixture(t);
  const guide = await readFile(new URL("../docs/resend.md", import.meta.url), "utf8");
  const example = guide.match(/```js\n([\s\S]*?)\n```/u)?.[1];
  assert.ok(example);
  // Evaluate only the trusted repository example to keep application wiring verified.
  const createRecoverySender = new Function("createHash", `${example.replace('import { createHash } from "node:crypto";', "")}\nreturn createRecoverySender;`)(createHash);
  const sender = createRecoverySender({ connections: service, context, integrationId: "mail", from: input.from });
  const auth = createLocalAuthService({
    backend: createLocalFileBackend({ storeDir: path.join(directory, "auth") }),
    config: { nodeEnv: "test", sessionSecret: "fixture-session-secret",
      appPublicUrl: "https://app.example.com", recoveryDevOutput: "response" },
    recoverySender: sender
  });
  await auth.register({ email: "person@example.com", password: "correct horse battery staple" });
  const result = await auth.requestPasswordReset({ email: "person@example.com" });
  assert.equal(result.recoveryUrl, undefined);
  assert.equal(requests.length, 2);
  const body = JSON.parse(requests[1].init.body);
  assert.deepEqual(body.to, ["person@example.com"]);
  const recoveryUrl = body.text.trim().split("\n").at(-1);
  const token = new URL(recoveryUrl).searchParams.get("token");
  const recovered = await auth.completePasswordRecovery({ code: token, type: "recovery" });
  assert.equal(recovered.actor.email, "person@example.com");
  await sender({ email: "person@example.com", recoveryUrl });
  assert.equal(new Headers(requests[2].init.headers).get("idempotency-key"),
    new Headers(requests[1].init.headers).get("idempotency-key"));
  assert.equal(requests[2].init.body, requests[1].init.body);
});


test("Resend marketing journey preserves subscription, drafts and explicitly authorized sending", async t => {
  const { service, requests, state } = await fixture(t);
  const invoke = (operation, values = {}) => service.invoke({ context, integrationId: "mail", operation, input: values });
  state.response = { id: "sender1", status: "verified", records: [{ type: "TXT", value: "fixture-dns" }] };
  assert.deepEqual(await invoke("domains.get", { id: "sender1" }), state.response);
  for (const resource of ["segments", "contacts", "broadcasts"]) {
    state.response = { object: "list", data: [{ id: "item1" }], has_more: true };
    assert.deepEqual(await invoke(`${resource}.list`, { limit: 2, after: "last+&2", ...(resource === "contacts" ? { segment_id: "segment1" } : {}) }), state.response);
    const url = new URL(requests.at(-1).url); assert.equal(url.searchParams.get("after"), "last+&2");
    if (resource === "contacts") assert.equal(url.searchParams.get("segment_id"), "segment1");
  }
  state.response = { object: "segment", id: "segment1", name: "Opted-in test recipients" };
  await invoke("segments.create", { name: state.response.name });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { name: state.response.name });
  state.response = { object: "contact", id: "contact1" };
  const contact = { email: "person@example.com", first_name: "Pat", unsubscribed: false, segments: [{ id: "segment1" }] };
  await invoke("contacts.create", contact);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), contact);
  state.response = { id: "contact1", ...contact };
  assert.deepEqual(await invoke("contacts.get", { id: "contact1" }), state.response);
  await invoke("contacts.update", { id: "contact1", unsubscribed: true });
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { unsubscribed: true });
  for (const operation of ["contacts.addSegment", "contacts.removeSegment"]) {
    state.response = { object: "contact_segment", contact_id: "contact1", segment_id: "segment1", ...(operation.endsWith("removeSegment") ? { deleted: true } : {}) };
    assert.deepEqual(await invoke(operation, { id: "contact1", segmentId: "segment1" }), state.response);
    assert.equal(new URL(requests.at(-1).url).pathname, "/contacts/contact1/segments/segment1");
  }
  const draft = { segment_id: "segment1", from: input.from, subject: "Newsletter",
    html: '<p>Hello {{{contact.first_name|there}}}</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>' };
  state.response = { id: "broadcast1" };
  await invoke("broadcasts.create", draft);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { ...draft, send: false });
  assert.ok(!requests.some(request => new URL(request.url).pathname.endsWith("/send")));
  state.response = { id: "broadcast1", ...draft, status: "draft" };
  assert.deepEqual(await invoke("broadcasts.get", { id: "broadcast1" }), state.response);
  await invoke("broadcasts.update", { id: "broadcast1", ...draft, subject: "Reviewed newsletter" });
  assert.equal(requests.at(-1).init.method, "PATCH");
  state.denied = "broadcasts.send"; const before = requests.length;
  await assert.rejects(invoke("broadcasts.send", { id: "broadcast1" }), { code: "connector_access_denied" });
  assert.equal(requests.length, before);
  state.denied = null; state.response = { id: "broadcast1" };
  await invoke("broadcasts.send", { id: "broadcast1" });
  assert.equal(new URL(requests.at(-1).url).pathname, "/broadcasts/broadcast1/send");
  assert.equal(requests.at(-1).init.method, "POST");
  const count = requests.length;
  for (const [operation, values] of [["contacts.create", { email: "person@example.com" }], ["contacts.get", { id: "../other" }], ["contacts.create", { ...contact, segments: Array(101).fill({ id: "segment1" }) }], ["broadcasts.create", { ...draft, send: true }], ["broadcasts.create", { ...draft, html: "No unsubscribe" }], ["broadcasts.create", { ...draft, subject: "Injected\r\nheader" }]])
    await assert.rejects(invoke(operation, values), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  for (const status of [403, 429, 500]) {
    state.status = status; const before = requests.length;
    await assert.rejects(invoke("broadcasts.send", { id: "broadcast1" }));
    assert.equal(requests.length, before + 1);
  }
  state.status = 200; state.response = {};
  await assert.rejects(invoke("broadcasts.get", { id: "broadcast1" }));
});
