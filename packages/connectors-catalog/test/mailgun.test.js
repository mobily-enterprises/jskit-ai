import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { mailgunProvider } from "../src/server/mailgun.js";

const context = { applicationId: "mail-app", subjectId: "business-mail" };
const domain = "mail.example.com";
const message = { domain, from: "Support <support@mail.example.com>", to: ["one@example.com", "two@example.com"],
  subject: "Your receipt", text: "Receipt\n", html: "<p>Receipt</p>" };
const dns = { domain: { name: domain, state: "unverified" },
  sending_dns_records: [{ record_type: "TXT", name: domain, value: "fixture-spf", valid: "unknown" }], receiving_dns_records: [] };
async function fixture(t, region = "us") {
  const directory = await mkdtemp(path.join(tmpdir(), "mailgun-repair-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { fail: false, status: 200, malformed: false, deny: false };
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { mail: {
      provider: "mailgun", accountMode: "shared", scopes: [], settings: { region },
      authentication: { method: "api-key", secretRef: "env:MAILGUN_KEY" }
    } } }, providers: [mailgunProvider],
    authorize: async owner => { if (state.deny) throw new Error("permission denied"); return owner; },
    resolveReference: async () => "fixture-private-key",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({
      keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current"
    }) }),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      if (state.fail) throw new Error("connection lost after request");
      if (state.status !== 200) return Response.json({ message: "fixture rejection" }, { status: state.status });
      if (state.malformed) return Response.json({});
      const pathname = new URL(url).pathname;
      if (pathname === "/v4/domains" && init.method === "GET") return Response.json({ items: [], total_count: 0 });
      if (pathname.endsWith("/messages")) return Response.json({ id: "<fixture@mail.example.com>", message: "Queued. Thank you." });
      if (pathname === "/v1/analytics/logs") return Response.json({ items: [
        { event: "failed", severity: "permanent", recipient: "one@example.com", "delivery-status": { code: 550 } }
      ], pagination: { next: "next-fixture-token" } });
      return Response.json(dns);
    }
  });
  await service.connectApiKey({ context, integrationId: "mail" });
  const invoke = (operation, input) => service.invoke({ context, integrationId: "mail", operation, input });
  return { service, requests, state, invoke };
}

for (const region of ["us", "eu"]) test(`Mailgun ${region}: verify key, send multipart, manage domain DNS, page delivery logs`, async t => {
  const { requests, invoke } = await fixture(t, region);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, "GET");
  const queued = await invoke("messages.send", message);
  assert.equal(queued.id, "<fixture@mail.example.com>");
  const sent = requests.at(-1);
  assert.equal(sent.url, `https://api${region === "eu" ? ".eu" : ""}.mailgun.net/v3/${domain}/messages`);
  assert.equal(sent.init.method, "POST");
  assert.ok(sent.init.body instanceof FormData);
  assert.deepEqual(sent.init.body.getAll("to"), message.to);
  assert.equal(sent.init.body.get("text"), message.text);
  assert.equal(sent.init.body.get("html"), message.html);
  assert.equal(new Headers(sent.init.headers).get("content-type"), null);
  assert.equal(new Headers(sent.init.headers).get("authorization"), `Basic ${Buffer.from("api:fixture-private-key").toString("base64")}`);
  for (const [operation, method, suffix] of [["domains.create", "POST", ""], ["domains.get", "GET", `/${domain}`],
    ["domains.verify", "PUT", `/${domain}/verify`]]) {
    assert.deepEqual(await invoke(operation, { domain }), dns);
    assert.equal(requests.at(-1).init.method, method);
    assert.equal(new URL(requests.at(-1).url).pathname, `/v4/domains${suffix}`);
  }
  const logs = await invoke("logs.list", { domain });
  assert.equal(logs.items[0].severity, "permanent");
  await invoke("logs.list", { domain, token: logs.pagination.next });
  const body = JSON.parse(requests.at(-1).init.body);
  assert.equal(body.pagination.token, "next-fixture-token");
  assert.equal(body.filter.AND[0].values[0].value, domain);
  assert.equal(body.include_subaccounts, false);
  assert.equal(body.duration, "1d");
});

test("Mailgun rejects unsafe/incomplete input, unauthorized use and uncertain sends without retry", async t => {
  const { service, requests, state, invoke } = await fixture(t);
  for (const bad of [{ ...message, domain: "../keys" }, { ...message, to: [] }, { ...message, to: ["invalid"] },
    { ...message, subject: "header\r\ninjection" }, { ...message, text: "" }]) {
    await assert.rejects(invoke("messages.send", bad));
  }
  await assert.rejects(service.invoke({ context: { ...context, applicationId: "other" }, integrationId: "mail",
    operation: "messages.send", input: message }));
  state.deny = true;
  await assert.rejects(invoke("domains.create", { domain }));
  state.deny = false;
  assert.equal(requests.length, 1);
  state.fail = true;
  await assert.rejects(invoke("messages.send", message));
  assert.equal(requests.length, 2);
  state.fail = false;
  for (const status of [429, 401]) {
    state.status = status;
    const before = requests.length;
    await assert.rejects(invoke("messages.send", message));
    assert.equal(requests.length, before + 1);
  }
  state.status = 200;
  await service.connectApiKey({ context, integrationId: "mail" });
  state.malformed = true;
  await assert.rejects(invoke("logs.list", { domain }), { code: "connector_response_invalid" });
});
