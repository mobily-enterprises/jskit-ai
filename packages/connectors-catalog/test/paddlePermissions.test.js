import test from "node:test";
import assert from "node:assert/strict";
import { paddleProvider } from "../src/server/paddle.js";
import { createConnectionService } from "../../connectors-core/src/server/index.js";

test("Paddle maps reads to the captured permission and requires exact host approval without executing payments", async () => {
  let approved = false;
  const decisions = [];
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { paddle: {
      provider: "paddle", accountMode: "shared", scopes: [], settings: { environment: "sandbox" },
      authentication: { method: "api-key", secretRef: "env:PADDLE_API_KEY" },
      assistantPolicy: { enabled: true, defaultPermission: "ask", actions: { "api.read": "never" } }
    } } },
    providers: [paddleProvider], executionMode: "assistant",
    store: { withConnection: () => assert.fail("No grant access is needed for rejected or host-only actions") },
    resolveReference: () => assert.fail("No credential is needed for policy checks"),
    fetchImpl: () => assert.fail("Authorization must not execute a provider payment action"),
    authorize: async (context, decision) => { decisions.push(decision); return { ...context, approved }; }
  };
  const runtime = createConnectionService(options);
  const input = { context: { applicationId: "app", subjectId: "owner" }, integrationId: "paddle" };
  await assert.rejects(runtime.invoke({ ...input, operation: "products.list", input: {} }), { code: "connector_access_denied" });
  assert.equal(decisions.length, 0);
  const action = { ...input, action: "products.create", input: { name: "Example", price: "1200", currency: "USD" } };
  await assert.rejects(runtime.authorizeAssistantAction(action), { code: "connector_approval_required" });
  assert.deepEqual(decisions[0].input, action.input);
  assert.deepEqual(decisions[0].assistantPermission, { action: "products.create", decision: "ask" });
  approved = true;
  await runtime.authorizeAssistantAction(action);
  await assert.rejects(runtime.authorizeAssistantAction({ ...action, action: "arbitrary.write" }), { code: "connector_operation_unknown" });
  await assert.rejects(runtime.invoke({ ...input, operation: "unimplemented.payment", input: action.input }), { code: "connector_operation_unknown" });
});

test("Paddle product and recurring-price writes validate inputs and do not retry failures", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createFileConnectionStore, createCredentialProtection } = await import("../../connectors-core/src/server/fileStorage.js");
  const directory = await mkdtemp(join(tmpdir(), "paddle-writes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const writes = [];
  let fail = false;
  const productId = `pro_${"a".repeat(26)}`;
  const priceId = `pri_${"b".repeat(26)}`;
  const webhookId = `ntfset_${"c".repeat(26)}`;
  const webhookWrites = [];
  const runtime = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { paddle: {
      provider: "paddle", accountMode: "shared", scopes: [], settings: { environment: "sandbox" },
      authentication: { method: "api-key", secretRef: "env:PADDLE_API_KEY" }
    } } }, providers: [paddleProvider], authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" }) }),
    resolveReference: async () => "private-key",
    fetchImpl: async (address, init) => {
      const url = new URL(address);
      assert.equal(url.origin, "https://sandbox-api.paddle.com");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer private-key");
      if (url.pathname.startsWith("/checkout-domains/")) {
        assert.equal(init.method, "GET");
        return Response.json({ data: { id: `chedom_${"d".repeat(26)}`, domain: "app.example.com", status: "action_required" } });
      }
      if (init.method === "GET") return Response.json({ data: [], meta: { pagination: { has_more: false } } });
      if (init.method === "PATCH") {
        assert.equal(url.pathname, `/notification-settings/${webhookId}`);
        webhookWrites.push(JSON.parse(init.body));
        return Response.json({ data: { id: webhookId, active: false, endpoint_secret_key: "private-signing-secret" } });
      }
      assert.equal(init.method, "POST");
      writes.push({ path: url.pathname, body: JSON.parse(init.body) });
      if (fail) return Response.json({ error: "private-key" }, { status: 500 });
      return Response.json({ data: { id: url.pathname === "/products" ? productId : priceId } }, { status: 201 });
    }
  });
  const input = { context: { applicationId: "app", subjectId: "owner" }, integrationId: "paddle" };
  await runtime.connectApiKey(input);
  const domain = await runtime.invoke({ ...input, operation: "checkoutDomains.get", input: { domain_id: `chedom_${"d".repeat(26)}` } });
  assert.equal(domain.data.status, "action_required");
  await assert.rejects(runtime.invoke({ ...input, operation: "checkoutDomains.get", input: { domain_id: "../../escape" } }), { code: "connector_input_invalid" });
  const product = { name: "Example", tax_category: "saas" };
  await runtime.invoke({ ...input, operation: "products.create", input: product });
  const price = { product_id: productId, description: "Monthly subscription", unit_price: { amount: "1200", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } };
  await runtime.invoke({ ...input, operation: "prices.create", input: price });
  assert.deepEqual(writes, [{ path: "/products", body: product }, { path: "/prices", body: price }]);
  await assert.rejects(runtime.invoke({ ...input, operation: "prices.create", input: { ...price, unit_price: { amount: "12.50", currency_code: "USD" } } }));
  await assert.rejects(runtime.invoke({ ...input, operation: "products.create", input: { name: "Missing tax category" } }));
  assert.equal(writes.length, 2);
  const webhook = await runtime.invoke({ ...input, operation: "webhooks.update", input: {
    notification_setting_id: webhookId, active: false, subscribed_events: ["transaction.completed"], traffic_source: "simulation"
  } });
  assert.deepEqual(webhookWrites, [{ active: false, subscribed_events: ["transaction.completed"], traffic_source: "simulation" }]);
  assert.equal(JSON.stringify(webhook).includes("private-signing-secret"), false);
  await assert.rejects(runtime.invoke({ ...input, operation: "webhooks.update", input: { notification_setting_id: webhookId } }), { code: "connector_input_invalid" });
  await assert.rejects(runtime.invoke({ ...input, operation: "webhooks.update", input: { notification_setting_id: "../../escape", active: false } }), { code: "connector_input_invalid" });
  assert.equal(webhookWrites.length, 1);
  fail = true;
  await assert.rejects(runtime.invoke({ ...input, operation: "products.create", input: product }), (error) => {
    assert.equal(error.message.includes("private-key"), false); return true;
  });
  assert.equal(writes.length, 3);
});
