import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { wordpressComProvider } from "../src/server/wordpress-com.js";

const callback = "https://app.example.test/connections/wordpress/callback";
const context = { applicationId: "app-one", subjectId: "person-one" };
const input = { context, integrationId: "publishing" };
const profile = { ID: 17, username: "editor", display_name: "Editor", token_client_id: 12345, token_site_id: 81, token_scope: ["users", "sites", "posts"] };

async function fixture(t, scopes = profile.token_scope) {
  const directory = await mkdtemp(path.join(tmpdir(), "wordpress-com-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { time: Date.now(), token: {}, profile: { ...structuredClone(profile), token_scope: [...scopes] }, status: 200, response: null };
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, registrations: {
      wordpress: { source: "own", clientId: "12345", clientSecretRef: "env:WP_CLIENT_SECRET", callbackUrlRef: "env:WP_CALLBACK" }
    }, integrations: {
      publishing: { provider: "wordpress-com", accountMode: "per-user", scopes: [...scopes], authentication: { method: "oauth2", registrationRef: "wordpress" } }
    } },
    providers: [wordpressComProvider], authorize: async (owner) => owner,
    resolveReference: async (ref) => ref === "env:WP_CALLBACK" ? callback : "fixture-client-secret",
    store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    async fetchImpl(address, init) {
      const url = new URL(String(address));
      requests.push({ url, init, headers: new Headers(init.headers) });
      assert.equal(url.origin, "https://public-api.wordpress.com");
      if (url.pathname === "/oauth2/token") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "12345");
        assert.equal(body.get("client_secret"), "fixture-client-secret");
        assert.equal(body.get("grant_type"), "authorization_code");
        return Response.json({ access_token: "fixture-access-token", token_type: "bearer", blog_id: "81", blog_url: "https://untrusted-blog.example/", ...state.token });
      }
      return Response.json(state.response ?? state.profile, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  async function start(using = service) {
    const { authorizationUrl } = await using.beginAuthorization(input);
    const url = new URL(authorizationUrl);
    const result = new URL(callback);
    result.searchParams.set("code", "fixture-code");
    result.searchParams.set("state", url.searchParams.get("state"));
    return { url, callbackUrl: result.href };
  }
  async function connect(using = service) {
    return using.completeAuthorization({ ...input, callbackUrl: (await start(using)).callbackUrl });
  }
  return { service, options, directory, protection, state, requests, start, connect };
}

test("WordPress.com verifies the issued client and scope grant, persists privately and isolates owners", async (t) => {
  const { service, options, directory, protection, state, requests, start } = await fixture(t);
  const { url, callbackUrl } = await start();
  assert.equal(url.origin + url.pathname, "https://public-api.wordpress.com/oauth2/authorize");
  assert.equal(url.searchParams.get("scope"), "users,sites,posts");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), callback);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.has("client_secret"), false);
  const connected = await service.completeAuthorization({ ...input, callbackUrl });
  assert.equal(connected.status, "connected");
  assert.deepEqual(connected.grantedScopes, ["users", "sites", "posts"]);
  const tokenBody = new URLSearchParams(requests[0].init.body);
  assert.equal(tokenBody.get("redirect_uri"), callback);
  assert.ok(tokenBody.get("code_verifier"));
  assert.equal(requests[1].url.pathname, "/rest/v1.1/me");
  assert.equal(requests[1].url.searchParams.get("fields"), "ID,username,display_name,token_scope,token_client_id,token_site_id");
  assert.equal(requests[1].headers.get("authorization"), "Bearer fixture-access-token");
  assert.equal(requests[1].init.redirect, "error");
  for (const name of await readdir(directory)) {
    const file = await readFile(path.join(directory, name), "utf8");
    for (const secret of ["fixture-client-secret", "fixture-access-token", "fixture-code"]) assert.equal(file.includes(secret), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), { ...connected, callbackUrl: callback });
  // No expiry or refresh token is documented in this code-exchange response.
  state.time += 1000 * 60 * 60 * 24 * 90;
  assert.deepEqual(await restarted.invoke({ ...input, operation: "profile.read" }), profile);
  assert.equal(requests.filter(({ url }) => url.pathname === "/oauth2/token").length, 1);
  const count = requests.length;
  for (const owner of [{ ...context, applicationId: "another-app" }, { ...context, subjectId: "another-person" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "profile.read" }), { code: "connector_reconnect_required" });
  }
  assert.equal(requests.length, count);
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("WordPress.com records reduced permissions and cannot restore scopes omitted by the token response", async (t) => {
  const { service, state, requests, connect } = await fixture(t);
  state.profile.token_scope = ["users", "posts", "unrequested"];
  assert.deepEqual((await connect()).grantedScopes, ["users", "posts"]);
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "sites.list" }), { code: "connector_scope_missing" });
  assert.equal(requests.length, count);
  state.token.scope = "users, posts";
  state.profile.token_scope = ["users", "sites", "posts"];
  assert.deepEqual((await connect()).grantedScopes, ["users", "posts"]);
  state.token.scope = "users";
  assert.deepEqual((await connect()).grantedScopes, ["users"]);
});

test("WordPress.com rejects wrong-client or malformed verification and preserves an existing grant", async (t) => {
  const { service, state, connect, start } = await fixture(t);
  await connect();
  const connected = await service.status(input);
  for (const invalid of [
    { ...profile, token_client_id: 999 }, { ...profile, token_scope: "users,posts" },
    { ...profile, token_scope: [17] }, { ...profile, token_scope: [] }, { ...profile, token_site_id: "https://another.example" },
    { error: "invalid_token", message: "fixture-access-token" }
  ]) {
    state.profile = invalid;
    const attempt = await start();
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: attempt.callbackUrl }), {
      code: Array.isArray(invalid.token_scope) && invalid.token_scope.length === 0 ? "connector_scope_missing" : "connector_response_invalid"
    });
    assert.deepEqual(await service.status(input), connected);
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: attempt.callbackUrl }), { code: "connector_attempt_invalid" });
  }
});

test("WordPress.com consent cancellation, denial and registration changes consume no credentials", async (t) => {
  const { service, options, requests, start } = await fixture(t);
  const cancelled = await start();
  await service.cancelAuthorization({ ...input, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  const denied = await start();
  const callbackUrl = new URL(denied.callbackUrl);
  callbackUrl.searchParams.delete("code");
  callbackUrl.searchParams.set("error", "access_denied");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: callbackUrl.href }), { code: "connector_consent_denied" });
  const stale = await start();
  const config = structuredClone(options.configuration);
  config.registrations.wordpress.clientId = "98765";
  const changed = createConnectionService({ ...options, configuration: config });
  await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: stale.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, 0);
});

test("WordPress.com lists accessible sites and bounded post pages without following resource links", async (t) => {
  const { service, state, requests, connect } = await fixture(t);
  await connect();
  state.response = { sites: [{ ID: 81, URL: "https://untrusted-site.example/path", name: "Company" }] };
  assert.deepEqual(await service.invoke({ ...input, operation: "sites.list", input: { site_visibility: "visible", site_activity: "active" } }), state.response);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { site_visibility: "visible", site_activity: "active" });
  state.response = { found: 1, posts: [{ ID: 19, title: "<b>Draft</b>", content: "<p>Content</p>" }], meta: { next_page: "https://another.example/?cursor=+&2" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "posts.list", input: {
    siteId: 81, number: 25, page_handle: "https://another.example/?cursor=+&2", search: "red & blue", status: "draft", context: "edit"
  } }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/rest/v1.1/sites/81/posts/");
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), {
    number: "25", page_handle: "https://another.example/?cursor=+&2", search: "red & blue", status: "draft", context: "edit"
  });
  assert.equal(requests.length, 4);
  for (const [operation, response, operationInput] of [["sites.list", { sites: [] }, {}], ["posts.list", { found: 0, posts: [] }, { siteId: 81 }]]) {
    state.response = response;
    assert.deepEqual(await service.invoke({ ...input, operation, input: operationInput }), response);
  }
  const count = requests.length;
  for (const bad of [
    {}, { siteId: 1.5 }, { siteId: "../../another" }, { siteId: 81, url: "https://another.example" },
    { siteId: 81, number: 101 }, { siteId: 81, number: 1.5 }, { siteId: 81, page_handle: "" },
    { siteId: 81, search: "x".repeat(501) }, { siteId: 81, status: "not-a-status" }, { siteId: 81, context: "raw" }
  ]) await assert.rejects(service.invoke({ ...input, operation: "posts.list", input: bad }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  for (const response of [{ found: 1, posts: [{}] }, { found: 1, posts: [], meta: { next_page: {} } }, { error: "denied" }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "posts.list", input: { siteId: 81 } }), { code: "connector_response_invalid" });
  }
});

test("WordPress.com redacts provider failures and requires consent again after rejection or explicit expiry", async (t) => {
  const { service, state, requests, connect } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = 200; state.response = null;
    await connect();
    state.status = status; state.response = { error: "failure", message: "fixture-access-token fixture-client-secret" };
    await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), (error) => {
      assert.equal(error.code, code);
      assert.equal(String(error).includes("fixture-"), false);
      return true;
    });
    assert.equal((await service.status(input)).status, status === 401 ? "reconnect-required" : "connected");
  }
  state.status = 200; state.response = null; state.token.expires_in = 60;
  await connect();
  state.time += 61_000;
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, count);
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("WordPress.com publishes explicit drafts and sparse page edits, and never retries deletion", async (t) => {
  const { service, state, requests, connect } = await fixture(t);
  await connect();
  const post = { ID: 19, site_ID: 81, title: "Draft & title", status: "draft", content: " <p>A + B & C</p>\n" };
  state.response = post;
  const invoke = (operation, values) => service.invoke({ ...input, operation, input: { siteId: 81, ...values } });
  assert.deepEqual(await invoke("posts.create", { title: post.title, content: post.content, type: "page", parent: 0 }), post);
  let request = requests.at(-1);
  assert.equal(request.url.pathname, "/rest/v1.1/sites/81/posts/new");
  assert.equal(request.url.searchParams.get("context"), "edit");
  assert.equal(request.init.method, "POST");
  assert.equal(request.headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(request.headers.get("authorization"), "Bearer fixture-access-token");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.init.body)), {
    title: post.title, content: post.content, type: "page", parent: "0", status: "draft", publicize: "false"
  });
  await invoke("posts.update", { postId: 19, status: "publish", featured_image: "", excerpt: "" });
  request = requests.at(-1);
  assert.equal(request.url.pathname, "/rest/v1.1/sites/81/posts/19");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.init.body)), { status: "publish", featured_image: "", excerpt: "" });
  await invoke("posts.get", { postId: 19, context: "display" });
  assert.equal(requests.at(-1).init.method, "GET");
  assert.equal(requests.at(-1).url.searchParams.get("context"), "display");
  const count = requests.length;
  for (const [operation, values] of [
    ["posts.create", {}], ["posts.update", { postId: 19 }], ["posts.update", { postId: 19, context: "edit" }],
    ["posts.create", { title: "A", status: "future" }], ["posts.create", { title: "A", type: "unregistered" }],
    ["posts.update", { postId: 19, featured_image: "https://untrusted.example/image" }],
    ["posts.get", { postId: "../19" }], ["posts.get", { postId: 19, siteId: "another.example" }],
    ["posts.delete", { postId: 19 }], ["posts.delete", { postId: 19, confirmDeletion: false }]
  ]) await assert.rejects(invoke(operation, values), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  for (const status of ["trash", "deleted"]) {
    state.response = { ...post, status };
    assert.equal((await invoke("posts.delete", { postId: 19, confirmDeletion: true })).status, status);
    assert.equal(requests.at(-1).url.pathname, "/rest/v1.1/sites/81/posts/19/delete");
    assert.equal(requests.at(-1).init.body, "");
  }
  state.response = post;
  await invoke("posts.restore", { postId: 19 });
  assert.equal(requests.at(-1).url.pathname, "/rest/v1.1/sites/81/posts/19/restore");
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status; state.response = { error: "failure", message: "fixture-access-token" };
    const before = requests.length;
    await assert.rejects(invoke("posts.delete", { postId: 19, confirmDeletion: true }), { code });
    assert.equal(requests.length, before + 1);
  }
  state.status = 200; state.response = { ...post, site_ID: null };
  await assert.rejects(invoke("posts.update", { postId: 19, title: "Changed" }), { code: "connector_response_invalid" });
  state.response = null; state.profile.token_scope = ["users"];
  await connect();
  const before = requests.length;
  await assert.rejects(invoke("posts.create", { title: "Denied" }), { code: "connector_scope_missing" });
  assert.equal(requests.length, before);
});

test("WordPress.com media uses indexed multipart bytes and preserves partial results without retries", async (t) => {
  const { service, state, requests, connect } = await fixture(t, ["users", "posts", "media"]);
  await connect();
  const media = { ID: 88, URL: "https://untrusted.example/image.png", title: "Uploaded", post_ID: 0 };
  const invoke = (operation, values) => service.invoke({ ...input, operation, input: { siteId: 81, ...values } });
  const bytes = Buffer.from([0, 1, 255, 10, 13]);
  const upload = { filename: "image.png", mimeType: "image/png", contentBase64: bytes.toString("base64"), caption: "A & B", parent_id: 0 };
  state.response = { media: [media], media_errors: [] };
  assert.deepEqual(await invoke("media.upload", upload), state.response);
  let request = requests.at(-1);
  assert.equal(request.url.pathname, "/rest/v1.1/sites/81/media/new");
  assert.equal(request.headers.get("authorization"), "Bearer fixture-access-token");
  assert.equal(request.headers.has("content-type"), false);
  const encoded = new Request(request.url, request.init);
  assert.match(encoded.headers.get("content-type"), /^multipart\/form-data; boundary=/u);
  const form = await encoded.formData();
  const file = form.get("media[0]");
  assert.equal(file.name, "image.png"); assert.equal(file.type, "image/png");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.equal(form.get("attrs[0][caption]"), "A & B");
  assert.equal(form.get("attrs[0][parent_id]"), "0");
  assert.equal(form.has("media_urls"), false);
  state.response = { media: [media], media_errors: { 1: { error: "upload_error", message: "An attachment failed" } } };
  const beforePartial = requests.length;
  assert.deepEqual(await invoke("media.upload", upload), state.response);
  assert.equal(requests.length, beforePartial + 1);
  state.response = { media: [], media_errors: [{ error: "invalid_file" }] };
  assert.deepEqual(await invoke("media.upload", upload), state.response);
  state.response = { found: 1, media: [media], meta: { next_page: "https://cursor.example/?a=1&b=2" } };
  assert.deepEqual(await invoke("media.list", { number: 30, page_handle: state.response.meta.next_page, post_ID: 0, mime_type: "image" }), state.response);
  request = requests.at(-1);
  assert.equal(request.url.pathname, "/rest/v1.1/sites/81/media/");
  assert.equal(request.url.searchParams.get("page_handle"), state.response.meta.next_page);
  assert.equal(request.url.searchParams.get("post_ID"), "0");
  state.response = media;
  await invoke("media.get", { mediaId: 88 });
  assert.equal(requests.at(-1).url.pathname, "/rest/v1.1/sites/81/media/88");
  await invoke("media.update", { mediaId: 88, alt: "", caption: "", parent_id: 19 });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.at(-1).init.body)), { alt: "", caption: "", parent_id: "19" });
  state.response = { ...media, status: "deleted" };
  await invoke("media.delete", { mediaId: 88, confirmDeletion: true });
  assert.equal(requests.at(-1).url.pathname, "/rest/v1.1/sites/81/media/88/delete");
  const count = requests.length;
  for (const [operation, values] of [
    ["media.upload", { ...upload, filename: "../image.png" }], ["media.upload", { ...upload, contentBase64: "!!!!" }],
    ["media.upload", { ...upload, contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }],
    ["media.upload", { ...upload, mimeType: "image/png\r\nX: y" }],
    ["media.update", { mediaId: 88 }], ["media.delete", { mediaId: 88 }],
    ["media.delete", { mediaId: 88, confirmDeletion: false }], ["media.list", { number: 101 }]
  ]) await assert.rejects(invoke(operation, values), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status; state.response = { error: "failure" };
    const before = requests.length;
    await assert.rejects(invoke("media.upload", upload), { code });
    assert.equal(requests.length, before + 1);
  }
  state.status = 200; state.response = { media: [{}] };
  await assert.rejects(invoke("media.upload", upload), { code: "connector_response_invalid" });
  state.response = null; state.profile.token_scope = ["users"];
  await connect();
  const before = requests.length;
  await assert.rejects(invoke("media.upload", upload), { code: "connector_scope_missing" });
  assert.equal(requests.length, before);
});

test("WordPress.com comments require explicit moderation and use the comments scope for post replies", async (t) => {
  const { service, state, requests, connect } = await fixture(t, ["users", "comments"]);
  await connect();
  const comment = { ID: 9, content: " <p>A & B</p>\n", status: "unapproved" };
  const invoke = (operation, values) => service.invoke({ ...input, operation, input: { siteId: 81, ...values } });
  state.response = { found: 1, site_ID: 81, comments: [comment] };
  assert.deepEqual(await invoke("comments.list", { status: "unapproved", page: 2, number: 10 }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/rest/v1.1/sites/81/comments/");
  assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  state.response = { found: 0, comments: [] };
  assert.deepEqual(await invoke("comments.list", {}), state.response);
  state.response = comment;
  for (const [operation, values, suffix] of [
    ["comments.create", { postId: 19, content: comment.content }, "posts/19/replies/new"],
    ["comments.reply", { commentId: 9, content: comment.content }, "comments/9/replies/new"]
  ]) {
    assert.deepEqual(await invoke(operation, values), comment);
    assert.equal(requests.at(-1).url.pathname, `/rest/v1.1/sites/81/${suffix}`);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.at(-1).init.body)), { content: comment.content });
  }
  await invoke("comments.get", { commentId: 9 });
  assert.equal(requests.at(-1).init.method, "GET");
  await invoke("comments.update", { commentId: 9, content: "Edited", status: "unapproved" });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.at(-1).init.body)), { content: "Edited", status: "unapproved" });
  for (const status of ["approved", "unapproved", "spam", "unspam", "trash", "untrash"]) {
    await invoke("comments.update", { commentId: 9, status });
    assert.equal(new URLSearchParams(requests.at(-1).init.body).get("status"), status);
  }
  const count = requests.length;
  for (const [operation, values] of [
    ["comments.update", { commentId: 9, content: "Would implicitly approve" }],
    ["comments.update", { commentId: 9, status: "invalid" }],
    ["comments.delete", { commentId: 9 }], ["comments.delete", { commentId: 9, confirmDeletion: false }],
    ["comments.reply", { commentId: 9, content: "" }], ["comments.list", { page: 0 }]
  ]) await assert.rejects(invoke(operation, values), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response = { ...comment, status: "deleted" };
  await invoke("comments.delete", { commentId: 9, confirmDeletion: true });
  assert.equal(requests.at(-1).url.pathname, "/rest/v1.1/sites/81/comments/9/delete");
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status; state.response = { error: "denied" };
    const before = requests.length;
    await assert.rejects(invoke("comments.reply", { commentId: 9, content: "Reply" }), { code });
    assert.equal(requests.length, before + 1);
  }
  state.status = 200; state.response = null; state.profile.token_scope = ["users"];
  await connect();
  const before = requests.length;
  await assert.rejects(invoke("comments.create", { postId: 19, content: "Denied" }), { code: "connector_scope_missing" });
  assert.equal(requests.length, before);
});

test("WordPress.com statistics preserve provider metrics and require a statistics grant", async (t) => {
  const { service, state, requests, connect } = await fixture(t, ["users", "stats"]);
  await connect();
  state.response = { date: "2026-09-12", stats: { views: 0, visitors: 0 }, visits: { fields: ["period", "views", "visitors"], data: [["2026-09-12", 0, 0]] } };
  assert.deepEqual(await service.invoke({ ...input, operation: "stats.read", input: { siteId: 81 } }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/rest/v1.1/sites/81/stats/");
  assert.equal(requests.at(-1).headers.get("authorization"), "Bearer fixture-access-token");
  for (const response of [{}, { date: "2026-09-12", stats: null, visits: [] }, { date: "2026-09-12", stats: {}, visits: "invalid" }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "stats.read", input: { siteId: 81 } }), { code: "connector_response_invalid" });
  }
  state.status = 403; state.response = { error: "denied" };
  await assert.rejects(service.invoke({ ...input, operation: "stats.read", input: { siteId: 81 } }), { code: "connector_permission_denied" });
  state.status = 200; state.response = null; state.profile.token_scope = ["users"];
  await connect();
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "stats.read", input: { siteId: 81 } }), { code: "connector_scope_missing" });
  assert.equal(requests.length, count);
});

test("WordPress.com taxonomy manages terms by encoded slug and assigns existing IDs to posts", async (t) => {
  const { service, state, requests, connect } = await fixture(t, ["users", "taxonomy", "posts"]);
  await connect();
  const invoke = (operation, values) => service.invoke({ ...input, operation, input: { siteId: 81, ...values } });
  const term = { ID: 12, name: "News & updates", slug: "news&updates?x=1", description: "" };
  for (const family of ["categories", "tags"]) {
    state.response = { found: 1, [family]: [term] };
    assert.deepEqual(await invoke(`${family}.list`, { number: 50, page: 2, search: "News & updates" }), state.response);
    assert.equal(requests.at(-1).url.pathname, `/rest/v1.1/sites/81/${family}/`);
    state.response = term;
    await invoke(`${family}.create`, { name: term.name, description: "", ...(family === "categories" ? { parent: 0 } : {}) });
    assert.equal(requests.at(-1).url.pathname, `/rest/v1.1/sites/81/${family}/new`);
    assert.equal(new URLSearchParams(requests.at(-1).init.body).get("name"), term.name);
    await invoke(`${family}.get`, { termSlug: term.slug });
    assert.equal(requests.at(-1).url.pathname, `/rest/v1.1/sites/81/${family}/slug:news%26updates%3Fx%3D1`);
    assert.equal(requests.at(-1).url.searchParams.has("x"), false);
    await invoke(`${family}.update`, { termSlug: term.slug, description: "" });
    assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.at(-1).init.body)), { description: "" });
    await invoke(`${family}.delete`, { termSlug: term.slug, confirmDeletion: true });
    assert.ok(requests.at(-1).url.pathname.endsWith("/delete"));
    const count = requests.length;
    for (const [action, values] of [["update", { termSlug: term.slug }], ["get", { termSlug: "../news" }],
      ["create", {}], ["delete", { termSlug: term.slug }]]) {
      await assert.rejects(invoke(`${family}.${action}`, values), { code: "connector_input_invalid" });
    }
    assert.equal(requests.length, count);
  }
  state.response = { ID: 19, site_ID: 81, title: "Post", status: "draft" };
  await invoke("posts.update", { postId: 19, categories: [12, 13], tags: [] });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.at(-1).init.body)), { categories: "12,13", tags: "" });
  state.status = 403; state.response = { error: "denied" };
  await assert.rejects(invoke("categories.create", { name: "Denied" }), { code: "connector_permission_denied" });
  state.status = 200; state.response = null; state.profile.token_scope = ["users", "posts"];
  await connect();
  const count = requests.length;
  await assert.rejects(invoke("tags.create", { name: "Denied" }), { code: "connector_scope_missing" });
  assert.equal(requests.length, count);
});

test("WordPress.com batches bounded same-site GETs and retains individual permission errors", async (t) => {
  const { service, state, requests, connect } = await fixture(t, ["users", "batch", "posts"]);
  await connect();
  const postsPath = "/sites/81/posts?context=edit&number=20";
  const mediaPath = "/sites/81/media?context=edit&number=20";
  state.response = {
    [postsPath]: { found: 1, posts: [{ ID: 19, title: "Hello" }] },
    [mediaPath]: { error: "authorization_required", message: "No media permission" }
  };
  const count = requests.length;
  assert.deepEqual(await service.invoke({ ...input, operation: "batch.read", input: { siteId: 81, resources: ["posts", "media"] } }), state.response);
  assert.equal(requests.length, count + 1);
  const request = requests.at(-1);
  assert.equal(request.url.origin + request.url.pathname, "https://public-api.wordpress.com/rest/v1.3/batch/");
  assert.deepEqual(request.url.searchParams.getAll("urls[]"), [postsPath, mediaPath]);
  assert.equal(request.init.method, "GET");
  assert.equal(request.headers.get("authorization"), "Bearer fixture-access-token");
  const before = requests.length;
  for (const bad of [[], ["posts", "posts"], ["https://other.example"], ["posts/new"], ["../me"]]) {
    await assert.rejects(service.invoke({ ...input, operation: "batch.read", input: { siteId: 81, resources: bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.response = { "/sites/81/stats?context=edit": { date: "2026-09-12", stats: {}, visits: [] } };
  await service.invoke({ ...input, operation: "batch.read", input: { siteId: 81, resources: ["stats"] } });
  assert.deepEqual(requests.at(-1).url.searchParams.getAll("urls[]"), ["/sites/81/stats?context=edit"]);
  for (const malformed of [[], {}, { result: "invalid" }]) {
    state.response = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "batch.read", input: { siteId: 81, resources: ["posts"] } }), { code: "connector_response_invalid" });
  }
  state.response = null; state.profile.token_scope = ["users", "posts"];
  await connect();
  const last = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "batch.read", input: { siteId: 81, resources: ["posts"] } }), { code: "connector_scope_missing" });
  assert.equal(requests.length, last);
});
