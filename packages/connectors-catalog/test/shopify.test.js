import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { shopifyProvider } from "../src/server/shopify.js";

const context = { applicationId: "app-one", subjectId: "store-one" };
const args = { context, integrationId: "shopify" };
const product = { id: "gid://shopify/Product/123", title: "Fixture product", handle: "fixture-product", status: "DRAFT" };

async function fixture(t, { method = "oauth2", scopes = ["read_products", "write_products"], assistantPolicy } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "shopify-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configuration = { schemaVersion: 1, registrations: method === "oauth2" ? {
    own: { source: "own", grantType: "client_credentials", clientId: "fixture-client", clientSecretRef: "env:SHOPIFY_SECRET" }
  } : {}, integrations: { shopify: { provider: "shopify", accountMode: "shared", scopes,
    authentication: method === "oauth2" ? { method, registrationRef: "own" } : { method, secretRef: "env:SHOPIFY_TOKEN" },
    settings: { shopDomain: "fixture-store.myshopify.com" }, ...(assistantPolicy ? { assistantPolicy } : {}) } } };
  const state = { time: Date.now(), tokenCount: 0, tokenPatch: {}, tokenStatus: 200, value: undefined,
    status: 200, approved: false, denied: false, token: "private-api-token", hang: false };
  const requests = []; const decisions = [];
  const options = { configuration, providers: [{ ...shopifyProvider, requestTimeoutMs: 70 }], now: () => state.time,
    authorize: async (owner, request) => { decisions.push(request); return state.denied ? null : { ...owner, approved: state.approved }; },
    resolveReference: async (ref) => { assert.ok(["env:SHOPIFY_SECRET", "env:SHOPIFY_TOKEN"].includes(ref)); return ref === "env:SHOPIFY_SECRET" ? "private-client-secret" : state.token; },
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(11) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); const headers = new Headers(init.headers); requests.push({ url, init });
      assert.equal(url.origin, "https://fixture-store.myshopify.com");
      assert.equal(init.method, "POST");
      if (url.pathname === "/admin/oauth/access_token") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("grant_type"), "client_credentials"); assert.equal(body.get("client_id"), "fixture-client");
        assert.equal(body.get("client_secret"), "private-client-secret"); assert.equal(body.has("redirect_uri"), false);
        state.tokenCount++;
        return Response.json(state.tokenStatus === 200 ? { access_token: `private-token-${state.tokenCount}`, scope: scopes.join(","), expires_in: 86399,
          ...state.tokenPatch } : { error: "invalid_client", error_description: "private-provider-detail" }, { status: state.tokenStatus });
      }
      assert.equal(url.pathname, "/admin/api/2026-07/graphql.json"); assert.equal(url.search, "");
      assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.equal(headers.has("authorization"), false);
      assert.equal(headers.get("x-shopify-access-token"), method === "oauth2" ? `private-token-${state.tokenCount}` : state.token);
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      const body = JSON.parse(init.body);
      let value = { data: { products: { nodes: [product], pageInfo: { hasNextPage: false, endCursor: "cursor-one" } } } };
      for (const name of ["Create", "Update", "Delete"]) if (body.query.includes(`mutation ConnectorProduct${name}`)) {
        value = { data: { [`product${name}`]: { ...(name === "Delete" ? { deletedProductId: product.id } : { product }), userErrors: [] } } };
      }
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      return Response.json(state.value === undefined ? value : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const connect = () => method === "oauth2" ? service.connectClientCredentials(args) : service.connectApiKey(args);
  return { directory, options, state, requests, decisions, service, connect };
}

test("Shopify verifies and persists organization-app grants with the Shopify header, renewal and bounded product pages", async (t) => {
  const f = await fixture(t); assert.equal((await f.connect()).status, "connected");
  const restarted = createConnectionService(f.options); assert.equal((await restarted.status(args)).status, "connected");
  const result = await restarted.invoke({ ...args, operation: "products.list", input: { first: 1, after: "cursor & next", query: "status:active" } });
  assert.deepEqual(result.data.products.nodes, [product]);
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body).variables, { first: 1, after: "cursor & next", query: "status:active" });
  f.state.time += 86400_000; await restarted.invoke({ ...args, operation: "products.list" }); assert.equal(f.state.tokenCount, 2);
  for (const file of await readdir(f.directory)) {
    const value = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["private-client-secret", "private-token-1", "private-token-2"]) assert.equal(value.includes(secret), false);
  }
  f.state.value = { data: { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } };
  assert.deepEqual(await restarted.invoke({ ...args, operation: "products.list" }), f.state.value);
});

test("Shopify existing Admin tokens rotate through the reference and never invoke an OAuth endpoint", async (t) => {
  const f = await fixture(t, { method: "api-key" }); await f.connect(); f.state.token = "private-rotated-token";
  await f.service.invoke({ ...args, operation: "products.list" }); assert.equal(f.state.tokenCount, 0);
  assert.equal((await f.service.status(args)).status, "connected");
  await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected");
});

test("Shopify sends bounded product mutations with variables, defaults new products to draft and exposes confirmed deletion", async (t) => {
  const f = await fixture(t); await f.connect();
  const title = 'A "quoted" product';
  await f.service.invoke({ ...args, operation: "products.create", input: { product: { title, tags: ["One", "Two"] } } });
  const created = JSON.parse(f.requests.at(-1).init.body);
  assert.deepEqual(created.variables, { product: { title, tags: ["One", "Two"], status: "DRAFT" } }); assert.equal(created.query.includes(title), false);
  await f.service.invoke({ ...args, operation: "products.update", input: { product: { id: product.id, title: "New title", descriptionHtml: "", tags: [], status: "ARCHIVED" } } });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body).variables.product, { id: product.id, title: "New title", descriptionHtml: "", tags: [], status: "ARCHIVED" });
  const deleted = await f.service.invoke({ ...args, operation: "products.delete", input: { input: { id: product.id } } });
  assert.equal(deleted.data.productDelete.deletedProductId, product.id);
  assert.match(JSON.parse(f.requests.at(-1).init.body).query, /synchronous: true/u);
});

test("Shopify validates paging, product types, unknown fields and mutation sizes before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const count = f.requests.length;
  for (const input of [{ first: 0 }, { first: 101 }, { first: 1.5 }, { after: "" }, { query: "x".repeat(1025) }, { shopDomain: "other.myshopify.com" }, { queryText: "mutation {}" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "products.list", input }));
  }
  for (const input of [{}, { product: {} }, { product: { title: "" } }, { product: { title: "x", tags: Array(251).fill("x") } },
    { product: { title: "x", price: "5.00" } }, { product: { title: "x", status: "PUBLISHED" } }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "products.create", input }));
  }
  for (const input of [{ product: { id: product.id } }, { product: { id: "gid://shopify/Order/123", title: "New" } }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "products.update", input }));
  }
  await assert.rejects(f.service.invoke({ ...args, operation: "products.delete", input: { id: product.id } }));
  assert.equal(f.requests.length, count);
});

test("Shopify preserves read-only configuration and actual OAuth grants even when assistant approval is granted", async (t) => {
  for (const method of ["oauth2", "api-key"]) {
    const f = await fixture(t, { method, scopes: ["read_products"] }); await f.connect(); const count = f.requests.length;
    f.state.approved = true;
    const assistant = createConnectionService({ ...f.options, executionMode: "assistant" });
    await assert.rejects(assistant.invoke({ ...args, operation: "products.create", input: { product: { title: "New" } } }), { code: "connector_scope_missing" });
    assert.equal(f.requests.length, count);
  }
  const f = await fixture(t); f.state.tokenPatch.scope = "read_products"; await f.connect();
  await assert.rejects(f.service.invoke({ ...args, operation: "products.create", input: { product: { title: "New" } } }), { code: "connector_scope_missing" });
  const write = await fixture(t, { scopes: ["write_products"] }); await write.connect(); await write.service.invoke({ ...args, operation: "products.list" });
});

test("Shopify packaged guide uses the actual portable schema and all captured assistant action names", async () => {
  const guide = await readFile(new URL("../docs/shopify.md", import.meta.url), "utf8");
  const config = JSON.parse([...guide.matchAll(/```json\n([\s\S]*?)\n```/gu)][0][1]);
  assert.deepEqual(parseIntegrationConfiguration(JSON.stringify(config), { providers: [shopifyProvider] }), config);
  assert.equal(shopifyProvider.assistantActions.length, 16);
  const labels = shopifyProvider.assistantActions.map((action) => action.label);
  for (const label of ["Enable Shopify", "Connect your Shopify store", "Claim your store", "Create product", "Update product", "Delete product",
    "Add product variant", "Update product variant", "Delete product variant", "Create discount code", "Update discount code", "Delete discount code",
    "Create price rule", "Update price rule", "Delete price rule"]) assert.ok(labels.includes(label));
});

test("Shopify binds connection access to the application, subject, permanent shop and credentials", async (t) => {
  const f = await fixture(t); await f.connect(); const count = f.requests.length;
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "products.list" }), { code: "connector_reconnect_required" });
  }
  const configuration = structuredClone(f.options.configuration); configuration.integrations.shopify.settings.shopDomain = "other.myshopify.com";
  const changed = createConnectionService({ ...f.options, configuration });
  assert.equal((await changed.status(args)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...args, operation: "products.list" }), { code: "connector_reconnect_required" });
  f.state.denied = true; await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, count);
});

test("Shopify handles revoked, malformed and rejected grants without reporting connected", async (t) => {
  for (const patch of [{ access_token: "" }, { expires_in: 0 }, { expires_in: "86399" }, { scope: "read_products write_products" }, { scope: "" }]) {
    const f = await fixture(t); f.state.tokenPatch = patch;
    await assert.rejects(f.connect(), { code: "connector_response_invalid" }); assert.equal((await f.service.status(args)).status, "disconnected");
  }
  const f = await fixture(t); await f.connect(); f.state.time += 86400_000; f.state.tokenStatus = 401;
  await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), { code: "connector_reconnect_required" });
  assert.equal((await f.service.status(args)).status, "reconnect-required");
});

test("Shopify rejects malformed GraphQL results and distinguishes throttling, denied access and user errors", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const value of [null, {}, { data: null }, { data: { products: { nodes: [{}], pageInfo: { hasNextPage: false, endCursor: null } } } },
    { data: { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } }, { errors: [{ message: "private-provider-detail" }], data: {} }, "<html>private</html>"]) {
    f.state.value = value; await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), { code: "connector_response_invalid" });
  }
  for (const [code, expected] of [["THROTTLED", "connector_rate_limited"], ["ACCESS_DENIED", "connector_permission_denied"]]) {
    f.state.value = { errors: [{ message: "private-provider-detail", extensions: { code } }] };
    await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), (error) => error.code === expected && !error.message.includes("private"));
  }
  for (const name of ["Create", "Update", "Delete"]) {
    f.state.value = { data: { [`product${name}`]: { userErrors: [{ field: ["title"], message: "private-provider-detail" }] } } };
    const input = name === "Delete" ? { input: { id: product.id } } : { product: { ...(name === "Update" ? { id: product.id } : {}), title: "New" } };
    const before = f.requests.length;
    await assert.rejects(f.service.invoke({ ...args, operation: `products.${name.toLowerCase()}`, input }), { code: "connector_operation_rejected" });
    assert.equal(f.requests.length, before + 1);
  }
});

test("Shopify assistant permissions require host approval for the exact action and immutable input", async (t) => {
  const f = await fixture(t); await f.connect();
  const assistant = createConnectionService({ ...f.options, executionMode: "assistant" });
  const input = { product: { title: "Approved product" } }; const call = { ...args, operation: "products.create", input };
  const count = f.requests.length;
  await assert.rejects(assistant.invoke(call), { code: "connector_approval_required" }); assert.equal(f.requests.length, count);
  assert.deepEqual(f.decisions.at(-1).assistantPermission, { action: "products.create", decision: "ask" });
  f.state.approved = true;
  const changing = createConnectionService({ ...f.options, executionMode: "assistant", authorize: async (owner, request) => {
    assert.deepEqual(request.input, input); input.product.title = "Caller changed"; request.input.product.title = "Policy changed";
    request.assistantPermission.decision = "always"; return { ...owner, approved: true };
  } });
  await changing.invoke(call); assert.equal(JSON.parse(f.requests.at(-1).init.body).variables.product.title, "Approved product");
  for (const approved of [false, undefined, "true", 1]) {
    f.state.approved = approved; await assert.rejects(assistant.invoke(call), { code: "connector_approval_required" });
  }
});

test("Shopify assistant never/always policies, overrides and disabled access preserve normal app authorization and cleanup", async (t) => {
  const f = await fixture(t, { assistantPolicy: { enabled: true, defaultPermission: "never", actions: { "products.list": "always", "products.create": "ask" } } });
  await f.connect(); const assistant = createConnectionService({ ...f.options, executionMode: "assistant" });
  await assistant.invoke({ ...args, operation: "products.list" });
  await assert.rejects(assistant.invoke({ ...args, operation: "products.delete", input: { input: { id: product.id } } }), { code: "connector_access_denied" });
  f.state.denied = true; await assert.rejects(assistant.invoke({ ...args, operation: "products.list" }), { code: "connector_access_denied" }); f.state.denied = false;
  const configuration = structuredClone(f.options.configuration); configuration.integrations.shopify.assistantPolicy.enabled = false;
  const disabled = createConnectionService({ ...f.options, configuration, executionMode: "assistant" });
  await assert.rejects(disabled.invoke({ ...args, operation: "products.list" }), { code: "connector_access_denied" });
  assert.equal((await disabled.status(args)).status, "connected"); await disabled.disconnect(args);
  assert.equal((await disabled.status(args)).status, "disconnected");
});

test("Shopify lifecycle permissions authorize declared host actions without inventing store activation or claiming", async (t) => {
  const f = await fixture(t); const assistant = createConnectionService({ ...f.options, executionMode: "assistant" });
  await assert.rejects(assistant.authorizeAssistantAction({ ...args, action: "claim", input: { store: "fixture-store" } }), { code: "connector_approval_required" });
  f.state.approved = true; await assistant.authorizeAssistantAction({ ...args, action: "claim", input: { store: "fixture-store" } });
  assert.deepEqual(f.decisions.at(-1).input, { store: "fixture-store" }); assert.equal(f.requests.length, 0);
  await assert.rejects(assistant.authorizeAssistantAction({ ...args, action: "invented" }), { code: "connector_operation_unknown" });
  await assert.rejects(f.service.authorizeAssistantAction({ ...args, action: "claim" }), { code: "connector_operation_unknown" });
  assert.throws(() => createConnectionService({ ...f.options, executionMode: "browser-choice" }));
});

test("Shopify reports provider failures and cancellation without retrying a product mutation", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, expected] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    f.state.status = 200; await f.connect(); f.state.status = status; f.state.value = { error: "private-provider-detail" };
    const count = f.requests.length;
    await assert.rejects(f.service.invoke({ ...args, operation: "products.create", input: { product: { title: "New" } } }), { code: expected });
    assert.equal(f.requests.length, count + 1); f.state.value = undefined;
  }
  f.state.status = 200; await f.connect(); f.state.hang = true;
  const controller = new AbortController(); const pending = f.service.invoke({ ...args, operation: "products.list", signal: controller.signal });
  setTimeout(() => controller.abort(), 10); await assert.rejects(pending, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), { code: "connector_provider_timeout" });
});

test("Shopify portable configuration rejects foreign hosts, raw credentials and invalid assistant policy values", async (t) => {
  const f = await fixture(t); const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [shopifyProvider] });
  assert.deepEqual(parse(f.options.configuration), f.options.configuration);
  for (const shopDomain of ["", "https://fixture-store.myshopify.com", "fixture-store.myshopify.com:443", "fixture-store.myshopify.com/path", "whatever.com", "fixture-store.myshopify.com.attacker.test", "-store.myshopify.com", "store..myshopify.com"]) {
    const config = structuredClone(f.options.configuration); config.integrations.shopify.settings.shopDomain = shopDomain;
    assert.throws(() => parse(config), (error) => Boolean(error.fieldErrors["integrations.shopify.settings.shopDomain"]));
  }
  for (const assistantPolicy of [{ enabled: "false" }, { enabled: "perhaps" }, { defaultPermission: "allow" }, { actions: { invented: "always" } }, { actions: { claim: true } }]) {
    const config = structuredClone(f.options.configuration); config.integrations.shopify.assistantPolicy = assistantPolicy; assert.throws(() => parse(config));
  }
  const config = structuredClone(f.options.configuration); config.registrations.own.clientSecretRef = "private-secret"; assert.throws(() => parse(config));
});
