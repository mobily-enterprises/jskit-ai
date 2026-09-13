import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { woocommerceProvider, verifyWooCommerceWebhook } from "../src/server/woocommerce.js";
import { wordpressSelfHostedProvider } from "../src/server/wordpress-self-hosted.js";

const context = { applicationId: "site-app", subjectId: "site-owner" };
const input = { context, integrationId: "site" };
const products = [{ id: 42, name: "Shirt", price: "20.00", stock_status: "instock", images: [{ src: "https://other-site.example/image.png" }] }];
const user = { id: 7, name: "Editor", slug: "editor", _links: { collection: [{ href: "https://other-site.example/users" }] } };
const cases = [
  { provider: woocommerceProvider, identityField: "consumerKey", identity: "ck_fixture123", secret: "cs_fixture123",
    reference: "env:WOO_CONSUMER_SECRET", response: products,
    requestPath: "/store/wp-json/wc/v3/products", query: { page: "1", per_page: "10", status: "any" } },
  { provider: wordpressSelfHostedProvider, identityField: "username", identity: "editor", secret: "abcd efgh ijkl mnop qrst uvwx",
    reference: "env:WORDPRESS_APP_PASSWORD", response: user,
    requestPath: "/store/wp-json/wp/v2/users/me", query: {} }
];

async function fixture(t, spec) {
  const directory = await mkdtemp(path.join(tmpdir(), "wordpress-connectors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current" });
  const requests = [];
  const state = { secret: spec.secret, status: 200, response: spec.response };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { site: {
      provider: spec.provider.id, accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: spec.reference },
      settings: { siteUrl: "https://merchant.example:8443/store/", [spec.identityField]: spec.identity },
      extensions: { preserve: true }
    } }, extensions: { fromCli: true } },
    providers: [spec.provider], authorize: async (owner) => owner,
    resolveReference: async (reference) => { assert.equal(reference, spec.reference); return state.secret; },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      return Response.json(state.response, { status: state.status, headers: { Link: '<https://other-site.example/next>; rel="next"' } });
    }
  };
  return { service: createConnectionService(options), options, directory, protection, requests, state };
}

for (const spec of cases) {
  test(`${spec.provider.name} preserves site paths and credential ownership through file restart and rotation`, async (t) => {
    const { service, options, directory, protection, requests, state } = await fixture(t, spec);
    const connected = await service.connectApiKey(input);
    assert.equal(connected.status, "connected");
    assert.equal(requests[0].url.origin, "https://merchant.example:8443");
    assert.equal(requests[0].url.pathname, spec.requestPath);
    assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), spec.query);
    assert.equal(requests[0].init.redirect, "error");
    assert.equal(requests[0].init.method, "GET");
    const authorization = `Basic ${Buffer.from(`${spec.identity}:${state.secret}`).toString("base64")}`;
    assert.equal(requests[0].headers.get("authorization"), authorization);
    assert.equal(requests[0].url.href.includes(state.secret), false);
    assert.equal(JSON.stringify(connected).includes(state.secret), false);
    for (const name of await readdir(directory)) {
      const text = await readFile(path.join(directory, name), "utf8");
      assert.equal(text.includes(state.secret), false);
      assert.equal(text.includes(authorization), false);
    }
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.deepEqual(await restarted.status(input), connected);
    state.secret = "rotated-secret";
    assert.deepEqual(await restarted.invoke({ ...input, operation: spec.provider.checkOperation }), spec.response);
    assert.equal(requests.at(-1).headers.get("authorization"), `Basic ${Buffer.from(`${spec.identity}:${state.secret}`).toString("base64")}`);
    for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-owner" }]) {
      await assert.rejects(restarted.invoke({ ...input, context: owner, operation: spec.provider.checkOperation }), { code: "connector_reconnect_required" });
    }
    assert.equal(requests.length, 2, "Returned links and images must not trigger requests.");
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });

  test(`${spec.provider.name} validates portable site configuration and Basic-auth identities`, async (t) => {
    const { options, requests } = await fixture(t, spec);
    const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [spec.provider] });
    assert.deepEqual(parse(options.configuration), options.configuration);
    for (const siteUrl of [undefined, "", "not-a-url", "http://merchant.example", "https:merchant.example", "https://user:password@merchant.example",
      "https://merchant.example?key=secret", "https://merchant.example#fragment", "https://merchant.example/store/../", "https://merchant.example/%2e%2e/",
      "https://merchant.example\\@attacker.example", "https://merchant.example/with space", "https://merchant.example\n/path", "https://merchant.example:99999"]) {
      const configuration = structuredClone(options.configuration);
      configuration.integrations.site.settings.siteUrl = siteUrl;
      assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.site.settings.siteUrl"]));
    }
    for (const siteUrl of ["https://merchant.example", "https://merchant.example/", "https://merchant.example/store/blog", "https://127.0.0.1:8443/site", "https://[::1]:8443/site"]) {
      const configuration = structuredClone(options.configuration);
      configuration.integrations.site.settings.siteUrl = siteUrl;
      assert.equal(parse(configuration).integrations.site.settings.siteUrl, siteUrl);
      const request = spec.provider.operations[spec.provider.checkOperation].request({}, { ...configuration.integrations.site.settings });
      assert.ok(request.url.startsWith(`${siteUrl.replace(/\/+$/u, "")}/wp-json/`));
    }
    for (const identity of [undefined, "", "user:password", "key\nheader", "key\u0000", "x".repeat(257)]) {
      const configuration = structuredClone(options.configuration);
      configuration.integrations.site.settings[spec.identityField] = identity;
      assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors[`integrations.site.settings.${spec.identityField}`]));
    }
    const configuration = structuredClone(options.configuration);
    configuration.integrations.site.authentication.secretRef = "raw-password";
    assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.site.authentication.secretRef"]));
    assert.equal(requests.length, 0);
  });

  test(`${spec.provider.name} re-verifies changed site or account settings and blocks operation destination overrides`, async (t) => {
    const { service, options, requests } = await fixture(t, spec);
    await service.connectApiKey(input);
    for (const [field, value] of [["siteUrl", "https://other-site.example"], ["siteUrl", "https://merchant.example:8443/another-installation"],
      [spec.identityField, spec.identityField === "consumerKey" ? "ck_other123" : "otheruser"]]) {
      const configuration = structuredClone(options.configuration);
      configuration.integrations.site.settings[field] = value;
      const changed = createConnectionService({ ...options, configuration });
      assert.equal((await changed.status(input)).status, "reconnect-required");
      await assert.rejects(changed.invoke({ ...input, operation: spec.provider.checkOperation }), { code: "connector_reconnect_required" });
    }
    const wrongHost = createConnectionService({ ...options, providers: [{ ...spec.provider, operations: {
      [spec.provider.checkOperation]: { scopes: [], request: () => ({ method: "GET", url: `https://other-site.example${spec.requestPath}` }) }
    } }] });
    await assert.rejects(wrongHost.invoke({ ...input, operation: spec.provider.checkOperation }), { code: "connector_destination_invalid" });
    for (const value of [{ url: "https://other-site.example" }, { siteUrl: "https://other-site.example" }, { consumer_secret: "override" }]) {
      await assert.rejects(service.invoke({ ...input, operation: spec.provider.checkOperation, input: value }), { code: "connector_input_invalid" });
    }
    assert.equal(requests.length, 1);
  });

  test(`${spec.provider.name} rejects invalid credentials, error envelopes and malformed responses without exposing secrets`, async (t) => {
    const { service, state } = await fixture(t, spec);
    for (const [status, code] of [[200, "connector_response_invalid"], [401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
      state.status = status;
      state.response = { code: "provider_denied", message: state.secret, data: { status } };
      await assert.rejects(service.connectApiKey(input), (error) => {
        assert.equal(error.code, code);
        assert.equal(error.stack.includes(state.secret), false);
        assert.equal(error.cause, undefined);
        return true;
      });
      assert.equal((await service.status(input)).status, "disconnected");
    }
    state.status = 200;
    state.response = spec.response;
    await service.connectApiKey(input);
    state.status = 401;
    await assert.rejects(service.invoke({ ...input, operation: spec.provider.checkOperation }), { code: "connector_reconnect_required" });
    assert.equal((await service.status(input)).status, "reconnect-required");
  });
}

test("WooCommerce reads bounded product and order pages without changing store data", async (t) => {
  const { service, requests, state } = await fixture(t, cases[0]);
  await service.connectApiKey(input);
  const query = { page: 2, per_page: 100, search: "Shirt & coat", sku: "shirt+blue", status: "draft", stock_status: "outofstock" };
  assert.deepEqual(await service.invoke({ ...input, operation: "products.list", input: query }), products);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])));
  state.response = [{ id: 51, status: "completed", total: "20.00", currency: "AUD", line_items: [{ product_id: 42 }] }];
  assert.deepEqual(await service.invoke({ ...input, operation: "orders.list", input: { page: 3, customer: 7, status: "completed" } }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/orders");
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { page: "3", per_page: "10", customer: "7", status: "completed" });
  for (const operation of ["products.list", "orders.list"]) {
    for (const invalid of [{ page: 0 }, { page: 1.5 }, { per_page: 101 }, { per_page: 0 }, { search: "x".repeat(501) }, { status: "unknown" }]) {
      await assert.rejects(service.invoke({ ...input, operation, input: invalid }), { code: "connector_input_invalid" });
    }
    state.response = [];
    assert.deepEqual(await service.invoke({ ...input, operation }), []);
    state.response = [{}];
    await assert.rejects(service.invoke({ ...input, operation }), { code: "connector_response_invalid" });
  }
  state.status = 403;
  await assert.rejects(service.invoke({ ...input, operation: "orders.list" }), { code: "connector_permission_denied" });
  assert.ok(requests.every(({ init }) => init.method === "GET"));
});

test("WordPress verifies the current user separately from public posts and preserves rendered content", async (t) => {
  const { service, requests, state } = await fixture(t, cases[1]);
  state.response = [];
  await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
  state.response = user;
  await service.connectApiKey(input);
  state.response = [{ id: 13, title: { rendered: "Fixture &amp; title" }, content: { rendered: "<p>Body</p>" }, status: "draft" }];
  assert.deepEqual(await service.invoke({ ...input, operation: "posts.list", input: { page: 2, per_page: 20, search: "Title & body", context: "edit", status: "draft" } }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wp/v2/posts");
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { page: "2", per_page: "20", search: "Title & body", context: "edit", status: "draft" });
  state.response = [];
  assert.deepEqual(await service.invoke({ ...input, operation: "posts.list" }), []);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { page: "1", per_page: "10", status: "publish", context: "view" });
  const count = requests.length;
  for (const invalid of [{ page: 0 }, { per_page: 101 }, { per_page: 1.5 }, { status: "any" }, { context: "private" }, { search: "" }, { _links: {} }]) {
    await assert.rejects(service.invoke({ ...input, operation: "posts.list", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  for (const malformed of [{ posts: [] }, [{}], [{ id: 1, title: { raw: "unsupported result" } }]]) {
    state.response = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "posts.list" }), { code: "connector_response_invalid" });
  }
  state.status = 403;
  await assert.rejects(service.invoke({ ...input, operation: "posts.list", input: { status: "private", context: "edit" } }), { code: "connector_permission_denied" });
  assert.ok(requests.every(({ init }) => init.method === "GET"));
});


test("WordPress publishes sparse post/page edits and requests trash without permanent deletion", async (t) => {
  const { service, options, requests, state } = await fixture(t, cases[1]);
  await service.connectApiKey(input);
  for (const resource of ["posts", "pages"]) {
    const record = { id: 42, title: { rendered: "Title" }, content: { rendered: "<p>Body</p>" }, status: "draft" };
    state.response = record;
    const content = "  <!-- wp:paragraph -->\n<p>Body</p>\n<!-- /wp:paragraph -->  ";
    assert.deepEqual(await service.invoke({ ...input, operation: `${resource}.create`, input: { title: "Title", content } }), record);
    let last = requests.at(-1);
    assert.equal(last.url.pathname, `/store/wp-json/wp/v2/${resource}`);
    assert.equal(last.init.method, "POST");
    assert.deepEqual(JSON.parse(last.init.body), { title: "Title", content, status: "draft" });
    assert.match(last.headers.get("authorization"), /^Basic /);
    assert.equal(last.url.search, "");
    state.response = { ...record, status: "publish" };
    await service.invoke({ ...input, operation: `${resource}.update`, input: { id: 42, status: "publish", excerpt: "", featured_media: 0 } });
    last = requests.at(-1);
    assert.equal(last.url.pathname, `/store/wp-json/wp/v2/${resource}/42`);
    assert.equal(last.init.method, "POST");
    assert.deepEqual(JSON.parse(last.init.body), { status: "publish", excerpt: "", featured_media: 0 });
    await service.invoke({ ...input, operation: `${resource}.get`, input: { id: 42, context: "edit" } });
    assert.equal(requests.at(-1).url.searchParams.get("context"), "edit");
    state.response = { ...record, status: "trash" };
    await service.invoke({ ...input, operation: `${resource}.trash`, input: { id: 42 } });
    assert.equal(requests.at(-1).init.method, "DELETE");
    assert.equal(requests.at(-1).url.searchParams.get("force"), "false");
    for (const invalid of [{ id: 42 }, { id: -1, title: "x" }, { id: 42, url: "https://other.example" }, { id: 42, status: "future" }]) {
      const before = requests.length;
      await assert.rejects(service.invoke({ ...input, operation: `${resource}.update`, input: invalid }), { code: "connector_input_invalid" });
      assert.equal(requests.length, before);
    }
    await assert.rejects(service.invoke({ ...input, operation: `${resource}.trash`, input: { id: 42, force: true } }), { code: "connector_input_invalid" });
  }
  state.response = [{ id: 9, title: { rendered: "Child page" }, parent: 3 }];
  assert.deepEqual(await service.invoke({ ...input, operation: "pages.list", input: { page: 2, per_page: 1, context: "edit", status: "draft" } }), state.response);
  assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  state.response = [];
  assert.deepEqual(await service.invoke({ ...input, operation: "pages.list" }), []);
  state.response = { id: 9, title: { rendered: "Child page" }, parent: 0 };
  await service.invoke({ ...input, operation: "pages.update", input: { id: 9, parent: 0, menu_order: -1 } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { parent: 0, menu_order: -1 });
  for (const status of [403, 429, 500]) {
    state.status = status; state.response = { code: "rest_cannot_create", message: "private failure" };
    const before = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "posts.create", input: { title: "Test" } }));
    assert.equal(requests.length, before + 1);
  }
  state.status = 200; state.response = { id: "42", title: { rendered: "Malformed" } };
  await assert.rejects(service.invoke({ ...input, operation: "pages.get", input: { id: 42 } }), { code: "connector_response_invalid" });
  const denied = createConnectionService({ ...options, authorize: async () => { throw new Error("Denied"); } });
  const before = requests.length;
  await assert.rejects(denied.invoke({ ...input, operation: "posts.create", input: { title: "Denied" } }));
  assert.equal(requests.length, before);
});


test("WordPress uploads exact multipart bytes and manages attachment metadata under the site account", async (t) => {
  const { service, requests, state } = await fixture(t, cases[1]);
  await service.connectApiKey(input);
  const media = { id: 51, title: { rendered: "Upload" }, source_url: "https://cdn.example/file.png", alt_text: "Picture" };
  const bytes = Buffer.from([0, 255, 137, 80, 78, 71, 13, 10]);
  state.response = media;
  const upload = { filename: "photo.png", mimeType: "image/png", contentBase64: bytes.toString("base64"), alt_text: "Picture", caption: "", post: 0 };
  assert.deepEqual(await service.invoke({ ...input, operation: "media.upload", input: upload }), media);
  const sent = requests.at(-1);
  assert.equal(sent.url.pathname, "/store/wp-json/wp/v2/media");
  assert.equal(sent.init.method, "POST");
  assert.equal(sent.init.body instanceof FormData, true);
  assert.equal(sent.headers.has("content-type"), false);
  const wire = new Request(sent.url, sent.init);
  assert.match(wire.headers.get("content-type"), /^multipart\/form-data; boundary=/);
  const form = await wire.formData();
  assert.deepEqual(Buffer.from(await form.get("file").arrayBuffer()), bytes);
  assert.equal(form.get("file").name, "photo.png");
  assert.equal(form.get("file").type, "image/png");
  assert.equal(form.get("post"), "0"); assert.equal(form.get("caption"), "");
  await service.invoke({ ...input, operation: "media.update", input: { id: 51, alt_text: "", post: 0 } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { alt_text: "", post: 0 });
  assert.deepEqual(await service.invoke({ ...input, operation: "media.get", input: { id: 51 } }), media);
  state.response = [media];
  await service.invoke({ ...input, operation: "media.list", input: { page: 2, per_page: 1, media_type: "image" } });
  assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  state.response = []; assert.deepEqual(await service.invoke({ ...input, operation: "media.list" }), []);
  for (const change of [{ contentBase64: "not base64" }, { contentBase64: "AA" }, { contentBase64: "Zh==" },
    { filename: "../image.png" }, { filename: "bad\nname" }, { mimeType: "image/png\nInjected: yes" },
    { contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }]) {
    const before = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "media.upload", input: { ...upload, ...change } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, before);
  }
  await assert.rejects(service.invoke({ ...input, operation: "media.delete", input: { id: 51 } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "media.delete", input: { id: 51, force: false } }), { code: "connector_input_invalid" });
  state.response = { deleted: true, previous: media };
  await service.invoke({ ...input, operation: "media.delete", input: { id: 51, force: true } });
  assert.equal(requests.at(-1).init.method, "DELETE"); assert.equal(requests.at(-1).url.searchParams.get("force"), "true");
  for (const status of [403, 413, 429, 500]) {
    state.status = status; state.response = { code: "upload_failed", message: "Private details" };
    const before = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "media.upload", input: upload }));
    assert.equal(requests.length, before + 1);
  }
});

test("WordPress user administration requires explicit role and deletion choices without persisting passwords", async (t) => {
  const { service, directory, requests, state } = await fixture(t, cases[1]);
  await service.connectApiKey(input);
  state.response = { id: 8, name: "Writer", slug: "writer", roles: ["author"] };
  const created = { username: "writer", email: "writer@example.test", password: "  secret password  ", roles: ["author"] };
  await assert.rejects(service.invoke({ ...input, operation: "users.create", input: { ...created, roles: undefined } }), { code: "connector_input_invalid" });
  assert.deepEqual(await service.invoke({ ...input, operation: "users.create", input: created }), state.response);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), created);
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wp/v2/users");
  await service.invoke({ ...input, operation: "users.update", input: { id: 8, name: "Renamed", description: "" } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { name: "Renamed", description: "" });
  await service.invoke({ ...input, operation: "users.get", input: { id: 8, context: "edit" } });
  assert.equal(requests.at(-1).url.searchParams.get("context"), "edit");
  const previous = state.response;
  state.response = [previous]; await service.invoke({ ...input, operation: "users.list", input: { page: 2 } });
  assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  for (const values of [{ id: 8, force: true }, { id: 8, reassign: 7, force: false }]) {
    await assert.rejects(service.invoke({ ...input, operation: "users.delete", input: values }), { code: "connector_input_invalid" });
  }
  state.response = { deleted: true, previous };
  await service.invoke({ ...input, operation: "users.delete", input: { id: 8, force: true, reassign: 7 } });
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { force: "true", reassign: "7" });
  for (const name of await readdir(directory)) assert.equal((await readFile(path.join(directory, name), "utf8")).includes(created.password), false);
  state.response = { ...previous, password: created.password };
  await assert.rejects(service.invoke({ ...input, operation: "users.get", input: { id: 8 } }), { code: "connector_response_invalid" });
  state.status = 403; state.response = { code: "rest_cannot_create_user", message: "Forbidden" };
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "users.create", input: created }), { code: "connector_permission_denied" });
  assert.equal(requests.length, before + 1);
});


test("WooCommerce customer/coupon discovery and record reads retain store paths and reject mismatched IDs", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  for (const [resource, record] of [["products", products[0]], ["orders", { id: 42, status: "processing", total: "20.01" }],
    ["customers", { id: 42, email: "customer@example.test", billing: { city: "Perth" } }], ["coupons", { id: 42, code: "fixture", amount: "10.00" }]]) {
    state.response = record;
    const call = { ...input, operation: `${resource}.get`, input: { id: 42 } };
    assert.deepEqual(await service.invoke(call), record);
    assert.equal(requests.at(-1).url.pathname, `/store/wp-json/wc/v3/${resource}/42`);
    assert.equal(requests.at(-1).url.search, "");
    state.response = { ...record, id: 43 };
    await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
    const count = requests.length;
    await assert.rejects(service.invoke({ ...call, input: { id: -1 } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
    if (["customers", "coupons"].includes(resource)) {
      state.response = [record];
      assert.deepEqual(await service.invoke({ ...input, operation: `${resource}.list`, input: { page: 2, per_page: 3 } }), [record]);
      assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
      state.response = [];
      assert.deepEqual(await service.invoke({ ...input, operation: `${resource}.list` }), []);
      state.response = [null];
      await assert.rejects(service.invoke({ ...input, operation: `${resource}.list` }), { code: "connector_response_invalid" });
    }
  }
});


test("WooCommerce coupon writes preserve restrictions and decimal values without retrying failures", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  state.response = { id: 42, code: "welcome", amount: "10.50", discount_type: "fixed_cart" };
  const fields = { code: "welcome", amount: "10.50", discount_type: "fixed_cart", product_ids: [7], usage_limit: 10, free_shipping: false };
  const create = { ...input, operation: "coupons.create", input: fields };
  assert.deepEqual(await service.invoke(create), state.response);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/coupons");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), fields);
  const update = { ...input, operation: "coupons.update", input: { id: 42, product_ids: [], individual_use: false, description: "" } };
  await service.invoke(update);
  assert.equal(requests.at(-1).init.method, "PUT");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { product_ids: [], individual_use: false, description: "" });
  let count = requests.length;
  for (const invalid of [{ amount: "-1" }, { amount: "1e3" }, { discount_type: "percent", amount: "101" }, { product_ids: [0] }, { usage_count: 0 }]) {
    await assert.rejects(service.invoke({ ...create, input: { ...fields, ...invalid } }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...update, input: { id: 42 } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response.id = 43;
  await assert.rejects(service.invoke(update), { code: "connector_response_invalid" });
  state.status = 500; state.response = { message: "Uncertain write" }; count = requests.length;
  await assert.rejects(service.invoke(create));
  assert.equal(requests.length, count + 1);
});


test("WooCommerce updates order status without silently submitting payment fields", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  state.response = { id: 42, status: "completed", total: "20.01", customer_note: "" };
  const call = { ...input, operation: "orders.update", input: { id: 42, status: "completed", customer_note: "" } };
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.at(-1).init.method, "PUT");
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/orders/42");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { status: "completed", customer_note: "" });
  const count = requests.length;
  for (const bad of [{ id: 42 }, { id: 42, set_paid: true }, { id: 42, status: "trash" }, { id: 42, transaction_id: "unverified" }]) {
    await assert.rejects(service.invoke({ ...call, input: bad }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.response.id = 43;
  await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  state.status = 403; state.response = { message: "Read only key" };
  await assert.rejects(service.invoke(call), { code: "connector_permission_denied" });
});


test("WooCommerce customer writes preserve partial addresses and reject account privilege fields", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  state.response = { id: 42, email: "customer@example.com" };
  const fields = { email: "customer@example.com", username: "customer", billing: { country: "AU", postcode: "0600" } };
  const create = { ...input, operation: "customers.create", input: fields };
  assert.deepEqual(await service.invoke(create), state.response);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/customers");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), fields);
  const update = { ...input, operation: "customers.update", input: { id: 42, shipping: { address_2: "" }, first_name: "" } };
  await service.invoke(update);
  assert.equal(requests.at(-1).init.method, "PUT");
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/customers/42");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { shipping: { address_2: "" }, first_name: "" });
  const count = requests.length;
  for (const bad of [{ id: 42 }, { id: 42, role: "administrator" }, { id: 42, billing: {} }, { id: 42, shipping: { role: "administrator" } }, { id: 42, is_paying_customer: true }]) {
    await assert.rejects(service.invoke({ ...update, input: bad }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...create, input: { first_name: "Missing email" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response.id = 43;
  await assert.rejects(service.invoke(update), { code: "connector_response_invalid" });
  state.status = 500; state.response = { message: "Uncertain customer creation" };
  const before = requests.length;
  await assert.rejects(service.invoke(create));
  assert.equal(requests.length, before + 1);
});


test("WooCommerce product writes require publication choice and retain exact price and stock changes", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  state.response = { id: 42, name: "Shirt" };
  const fields = { name: "Shirt", status: "draft", regular_price: "20.00", manage_stock: true, stock_quantity: 0, images: [{ id: 7, alt: "Front" }] };
  const call = { ...input, operation: "products.create", input: fields };
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/products");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), fields);
  const update = { ...input, operation: "products.update", input: { id: 42, sale_price: "", stock_quantity: -1, featured: false, categories: [] } };
  await service.invoke(update);
  assert.equal(requests.at(-1).init.method, "PUT");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { sale_price: "", stock_quantity: -1, featured: false, categories: [] });
  const count = requests.length;
  for (const changes of [{ regular_price: "-1" }, { regular_price: 20 }, { regular_price: "2e1" }, { stock_quantity: 0.5 }, { price: "10" }, { images: [{ src: "https://other.example/file" }] }]) {
    await assert.rejects(service.invoke({ ...call, input: { ...fields, ...changes } }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...call, input: { name: "No publication choice" } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...update, input: { id: 42 } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response.id = 43;
  await assert.rejects(service.invoke(update), { code: "connector_response_invalid" });
  state.status = 500; const before = requests.length;
  await assert.rejects(service.invoke(call)); assert.equal(requests.length, before + 1);
});


test("WooCommerce variations bind parent and child routes and preserve sparse stock updates", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  const record = { id: 71, price: "12.00", attributes: [{ name: "Size", option: "M" }] };
  state.response = [record];
  const list = { ...input, operation: "variations.list", input: { product_id: 42, page: 2, per_page: 5 } };
  assert.deepEqual(await service.invoke(list), [record]);
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/products/42/variations");
  assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  assert.equal(requests.at(-1).url.searchParams.has("product_id"), false);
  state.response = record;
  const get = { ...input, operation: "variations.get", input: { product_id: 42, id: 71 } };
  assert.deepEqual(await service.invoke(get), record);
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/products/42/variations/71");
  const update = { ...get, operation: "variations.update", input: { ...get.input, regular_price: "12.00", sale_price: "", manage_stock: true, stock_quantity: 0 } };
  await service.invoke(update);
  assert.equal(requests.at(-1).init.method, "PUT");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { regular_price: "12.00", sale_price: "", manage_stock: true, stock_quantity: 0 });
  const count = requests.length;
  for (const bad of [{ product_id: 0, id: 71 }, { product_id: 42, id: 71 }, { product_id: 42, id: 71, regular_price: 12 }, { product_id: 42, id: 71, stock_quantity: 1.5 }]) {
    await assert.rejects(service.invoke({ ...update, input: bad }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.response = { ...record, id: 72 };
  await assert.rejects(service.invoke(get), { code: "connector_response_invalid" });
  state.response = [null];
  await assert.rejects(service.invoke(list), { code: "connector_response_invalid" });
  state.response = [];
  assert.deepEqual(await service.invoke(list), []);
});


test("WooCommerce deletion requires explicit permanence and retains reassignment without retries", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  for (const [resource, record] of Object.entries({ products: { id: 42, name: "Shirt" }, orders: { id: 42, status: "trash", total: "10.00" }, customers: { id: 42, email: "customer@example.com" }, coupons: { id: 42, code: "discount", amount: "1.00" }, variations: { id: 42, price: "10.00" } })) {
    state.response = record;
    const fields = { id: 42, force: ["customers", "variations"].includes(resource), ...(resource === "customers" ? { reassign: 7 } : {}), ...(resource === "variations" ? { product_id: 10 } : {}) };
    const call = { ...input, operation: `${resource}.delete`, input: fields };
    assert.deepEqual(await service.invoke(call), record);
    assert.equal(requests.at(-1).init.method, "DELETE");
    assert.equal(requests.at(-1).url.pathname, `/store/wp-json/wc/v3/${resource === "variations" ? "products/10/variations" : resource}/42`);
    assert.equal(requests.at(-1).url.searchParams.get("force"), String(fields.force));
    if (resource === "customers") assert.equal(requests.at(-1).url.searchParams.get("reassign"), "7");
    const before = requests.length;
    for (const force of [undefined, "true", 1]) await assert.rejects(service.invoke({ ...call, input: { ...fields, force } }), { code: "connector_input_invalid" });
    if (fields.force) await assert.rejects(service.invoke({ ...call, input: { ...fields, force: false } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, before);
    state.response = { ...record, id: 43 };
    await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
    state.status = 500; const count = requests.length;
    await assert.rejects(service.invoke(call)); assert.equal(requests.length, count + 1);
    state.status = 200;
  }
});


test("WooCommerce creates a variable parent and explicitly selected variation without fan-out", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  state.response = { id: 42, name: "Shirt" };
  const parent = { name: "Shirt", type: "variable", status: "draft", attributes: [{ name: "Size", visible: true, variation: true, options: ["S", "M"] }] };
  await service.invoke({ ...input, operation: "products.create", input: parent });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), parent);
  state.response = { id: 71, price: "10.00", attributes: [{ name: "Size", option: "M" }] };
  const fields = { product_id: 42, status: "draft", attributes: [{ name: "Size", option: "M" }], regular_price: "10.00" };
  const call = { ...input, operation: "variations.create", input: fields };
  const before = requests.length;
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.length, before + 1);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/products/42/variations");
  const { product_id, ...body } = fields;
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), body);
  const count = requests.length;
  for (const bad of [{ status: undefined }, { attributes: [] }, { attributes: [{ name: "Size" }] }, { id: 71 }]) {
    await assert.rejects(service.invoke({ ...call, input: { ...fields, ...bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.status = 500;
  await assert.rejects(service.invoke(call)); assert.equal(requests.length, count + 1);
});


test("WooCommerce order creation preserves chosen customer and variations without marking paid", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  state.response = { id: 42, status: "pending", total: "20.00" };
  const fields = { customer_id: 7, status: "pending", line_items: [{ product_id: 10, variation_id: 11, quantity: 2 }], billing: { postcode: "0600", email: "customer@example.com" }, coupon_lines: [{ code: "WELCOME" }] };
  const call = { ...input, operation: "orders.create", input: fields };
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/orders");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), fields);
  const count = requests.length;
  for (const bad of [{ customer_id: undefined }, { status: "completed" }, { set_paid: true }, { transaction_id: "not-proof" }, { line_items: [] }, { line_items: [{ product_id: 10, quantity: 0 }] }, { total: "0.00" }]) {
    await assert.rejects(service.invoke({ ...call, input: { ...fields, ...bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.status = 500;
  await assert.rejects(service.invoke(call)); assert.equal(requests.length, count + 1);
  state.status = 200; state.response = { id: 42 };
  await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
});


test("WooCommerce webhook verification authenticates exact bytes without trusting event headers", () => {
  const secret = "fixture-webhook-secret";
  const rawBody = Buffer.from('{"id":42,"name":"Café"}');
  const signature = createHmac("sha256", secret).update(rawBody).digest("base64");
  assert.equal(verifyWooCommerceWebhook({ rawBody, signature, secret }), true);
  assert.equal(verifyWooCommerceWebhook({ rawBody: new Uint8Array(rawBody), signature, secret }), true);
  for (const changed of [{ rawBody: Buffer.from('{ "id":42,"name":"Café"}') }, { rawBody: JSON.parse(rawBody) }, { secret: "wrong" }, { secret: "" }, { signature: "" }, { signature: signature.slice(0, -1) }, { signature: [signature] }, { rawBody: Buffer.alloc(2 * 1024 * 1024 + 1) }]) {
    assert.throws(() => verifyWooCommerceWebhook({ rawBody, signature, secret, ...changed }), { code: "connector_webhook_invalid" });
  }
  // Replays still authenticate: durable event deduplication belongs to the receiver.
  assert.equal(verifyWooCommerceWebhook({ rawBody, signature, secret }), true);
});


test("WooCommerce categories retain hierarchy and require explicit permanent deletion", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  const record = { id: 42, name: "Clothes", parent: 0 };
  state.response = [record];
  await service.invoke({ ...input, operation: "categories.list", input: { hide_empty: false, parent: 0, page: 2 } });
  assert.equal(requests.at(-1).url.searchParams.get("hide_empty"), "false");
  assert.equal(requests.at(-1).url.searchParams.get("parent"), "0");
  state.response = record;
  for (const [action, fields, method] of [["create", { name: "Clothes", parent: 0 }, "POST"], ["update", { id: 42, description: "", menu_order: 0 }, "PUT"], ["get", { id: 42 }, "GET"], ["delete", { id: 42, force: true }, "DELETE"]]) {
    await service.invoke({ ...input, operation: `categories.${action}`, input: fields });
    assert.equal(requests.at(-1).init.method, method);
    assert.equal(requests.at(-1).url.pathname, `/store/wp-json/wc/v3/products/categories${action === "create" ? "" : "/42"}`);
    if (["POST", "PUT"].includes(method)) { const { id, ...body } = fields; assert.deepEqual(JSON.parse(requests.at(-1).init.body), body); }
  }
  const count = requests.length;
  for (const force of [false, "true", undefined]) await assert.rejects(service.invoke({ ...input, operation: "categories.delete", input: { id: 42, force } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "categories.update", input: { id: 42, parent: 42 } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response = { ...record, id: 43 };
  await assert.rejects(service.invoke({ ...input, operation: "categories.get", input: { id: 42 } }), { code: "connector_response_invalid" });
});


test("WooCommerce reports preserve native money and reject ambiguous date requests", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  state.response = [{ total_sales: "10.01", net_sales: "9.00", total_orders: 1, totals: { "2026-09-01": { sales: "10.01", refunds: "1.01" } } }];
  const call = { ...input, operation: "reports.sales", input: { date_min: "2026-09-01", date_max: "2026-09-13" } };
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/reports/sales");
  assert.equal(requests.at(-1).url.searchParams.get("date_min"), "2026-09-01");
  const count = requests.length;
  for (const bad of [{ date_min: "2026-02-30", date_max: "2026-03-01" }, { date_min: "2026-09-13", date_max: "2026-09-01" }, { date_min: "2026-09-01" }, { ...call.input, period: "month" }]) {
    await assert.rejects(service.invoke({ ...call, input: bad }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  for (const resource of ["orders", "products", "customers", "coupons"]) {
    state.response = [{ slug: "group", name: "Group", total: 0 }];
    assert.deepEqual(await service.invoke({ ...input, operation: `reports.${resource}` }), state.response);
    assert.equal(requests.at(-1).url.pathname, `/store/wp-json/wc/v3/reports/${resource}/totals`);
  }
  state.response = [{ product_id: 42, title: "Shirt", quantity: 2 }];
  await service.invoke({ ...input, operation: "reports.topSellers", input: { period: "month" } });
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/reports/top_sellers");
  state.response = [null]; await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
});


test("WooCommerce refunds require deliberate payment/restock choices and never replay uncertain writes", async t => {
  const { service, requests, state } = await fixture(t, cases[0]); await service.connectApiKey(input);
  const record = { id: 71, amount: "10.00", refunded_payment: false };
  state.response = [record];
  await service.invoke({ ...input, operation: "refunds.list", input: { order_id: 42, page: 2 } });
  assert.equal(requests.at(-1).url.pathname, "/store/wp-json/wc/v3/orders/42/refunds");
  state.response = record;
  const fields = { order_id: 42, amount: "10.00", reason: "Returned item", api_refund: false, api_restock: false };
  const call = { ...input, operation: "refunds.create", input: fields };
  assert.deepEqual(await service.invoke(call), record);
  const { order_id, ...body } = fields;
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), body);
  assert.equal(requests.at(-1).init.method, "POST");
  const gateway = { ...fields, api_refund: true, api_restock: true, line_items: [{ id: 5, quantity: 1, refund_total: "10.00" }] };
  state.response = { ...record, refunded_payment: true };
  await service.invoke({ ...call, input: gateway });
  assert.equal(JSON.parse(requests.at(-1).init.body).api_refund, true);
  const count = requests.length;
  for (const bad of [{ api_refund: undefined }, { api_refund: "true" }, { amount: 10 }, { amount: "-1" }, { api_restock: true }, { line_items: [{ id: 5, quantity: 1, refund_total: 10 }] }]) {
    await assert.rejects(service.invoke({ ...call, input: { ...fields, ...bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.status = 500;
  await assert.rejects(service.invoke(call)); assert.equal(requests.length, count + 1);
  state.status = 200; state.response = { ...record, id: 72 };
  await assert.rejects(service.invoke({ ...input, operation: "refunds.get", input: { order_id: 42, id: 71 } }), { code: "connector_response_invalid" });
});
