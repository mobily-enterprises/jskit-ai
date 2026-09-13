import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { githubApiProvider } from "../src/server/github-api.js";

for (const perUser of [false, true]) test(`GitHub OAuth ${perUser ? "per-user non-expiring" : "shared rotating"} grants preserve protocol and ownership`, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "github-oauth-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const callback = "https://example.test/integrations/github-api/callback";
  const context = { applicationId: "app", subjectId: "owner" };
  const input = { context, integrationId: "github" };
  let time = Date.now(), exchanges = 0;
  let tokenScope = "read:user,repo", apiStatus = 200;
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, registrations: { github: { source: "own", clientId: "client", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK", tokenEndpointAuthMethod: "client_secret_post" } }, integrations: {
      github: { provider: "github-api", accountMode: perUser ? "per-user" : "shared", scopes: ["read:user", "repo"], authentication: { method: "oauth2", registrationRef: "github" } },
      personal: { provider: "github-api", accountMode: "shared", scopes: ["read:user", "repo"], authentication: { method: "api-key", secretRef: "env:TOKEN" } }
    } }, providers: [githubApiProvider], authorize: async owner => owner,
    store: createFileConnectionStore({ directory, protection }), now: () => time,
    resolveReference: async ref => ref === "env:CALLBACK" ? callback : ref === "env:TOKEN" ? "personal" : "secret",
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)), headers = new Headers(init.headers);
      if (url.origin === "https://github.com") {
        assert.equal(url.pathname, "/login/oauth/access_token");
        assert.equal(headers.get("accept"), "application/json");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_secret"), "secret");
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback);
          assert.ok(body.get("code_verifier"));
        } else assert.equal(body.get("refresh_token"), `refresh-${exchanges}`);
        exchanges++;
        if (perUser) return Response.json({ access_token: `access-${exchanges}`, token_type: "Bearer", scope: tokenScope });
        return Response.json({ access_token: `access-${exchanges}`, refresh_token: `refresh-${exchanges}`, token_type: "Bearer", expires_in: 60, scope: tokenScope });
      }
      assert.equal(url.origin, "https://api.github.com");
      assert.ok([`Bearer access-${exchanges}`, "Bearer personal"].includes(headers.get("authorization")));
      if (apiStatus !== 200) return Response.json({ message: "private provider detail" }, { status: apiStatus });
      assert.equal(headers.get("x-github-api-version"), "2026-03-10");
      assert.equal(headers.get("user-agent"), "jskit-connectors");
      return Response.json({ id: 123, login: "fixture" });
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
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const returned = new URL(callback);
  returned.searchParams.set("code", "code");
  returned.searchParams.set("state", url.searchParams.get("state"));
  assert.equal((await service.completeAuthorization({ ...input, callbackUrl: returned.href })).status, "connected");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: returned.href }), { code: "connector_attempt_invalid" });
  time += 40_000;
  await Promise.all([service.invoke({ ...input, operation: "account.read" }), service.invoke({ ...input, operation: "account.read" })]);
  assert.equal(exchanges, perUser ? 1 : 2);
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  time += 40_000;
  await restarted.invoke({ ...input, operation: "account.read" });
  assert.equal(exchanges, perUser ? 1 : 3);
  assert.equal((await restarted.connectApiKey({ context, integrationId: "personal" })).status, "connected");
  const otherApp = { context: { ...context, applicationId: "another-app" }, integrationId: "github" };
  assert.equal((await restarted.status(otherApp)).status, "disconnected");
  if (perUser) {
    const otherUser = { context: { ...context, subjectId: "another-user" }, integrationId: "github" };
    assert.equal((await restarted.status(otherUser)).status, "disconnected");
    await assert.rejects(restarted.invoke({ ...otherUser, operation: "account.read" }));
    assert.equal((await restarted.status(input)).status, "connected");
  }
  await restarted.disconnect(input);
  assert.equal((await restarted.status(input)).status, "disconnected");
});

test("GitHub token normalization rejects malformed grants and retains OAuth error responses", async () => {
  for (const scope of [null, ["repo"], "repo,,gist", "repo gist", { repo: true }]) {
    await assert.rejects(githubApiProvider.normalizeTokenResponse(Response.json({ access_token: "private", token_type: "bearer", scope })), { code: "connector_response_invalid" });
  }
  const failure = Response.json({ error: "bad_verification_code" });
  assert.equal(await githubApiProvider.normalizeTokenResponse(failure), failure);
  const denied = new Response("denied", { status: 403 });
  assert.equal(await githubApiProvider.normalizeTokenResponse(denied), denied);
  for (const scope of ["", "read:user", "read:user,repo"]) {
    const result = await githubApiProvider.normalizeTokenResponse(Response.json({ access_token: "private", token_type: "bearer", scope }));
    assert.equal((await result.json()).scope, scope.replaceAll(",", " "));
  }
});

test("GitHub repository reads and issue/PR writes preserve paths, pagination and uncertain outcomes", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "github-content-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = []; let status = 200, malformed = false, fail = false;
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { github: { provider: "github-api", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:GITHUB_TOKEN" } } } },
    providers: [githubApiProvider], authorize: async owner => owner, resolveReference: async () => "private-token",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, init) => {
      const parsed = new URL(url); requests.push({ url: parsed, init });
      assert.equal(parsed.origin, "https://api.github.com");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer private-token");
      assert.equal(init.redirect, "error");
      if (fail) throw new Error("outcome unknown");
      if (status !== 200) return Response.json({ message: "private provider detail" }, { status });
      if (malformed) return Response.json({});
      const route = parsed.pathname;
      if (route === "/user") return Response.json({ id: 1, login: "owner" });
      if (route.endsWith("/contents/docs/read%20me.md")) return Response.json({ type: "file", path: "docs/read me.md", encoding: "base64", content: Buffer.from("Useful documentation").toString("base64") });
      if (route.endsWith("/actions/runs")) return Response.json({ workflow_runs: [{ id: 2, conclusion: "success" }] });
      if (route === "/repos/owner/project") return Response.json({ id: 1, full_name: "owner/project" });
      if (init.method === "POST" || init.method === "PATCH") return Response.json({ number: 7, title: "Fix checkout", ...JSON.parse(init.body) });
      if (/\/(issues|pulls)\/7$/.test(route)) return Response.json({ number: 7, title: "Fix checkout", body: "Customer report" });
      return Response.json([{ id: 3, name: "main", body: "Review comment", sha: "revision" }]);
    }
  });
  const owner = { context: { applicationId: "repo-app", subjectId: "owner" }, integrationId: "github" };
  const invoke = (operation, input = {}) => service.invoke({ ...owner, operation, input: { owner: "owner", repo: "project", ...input } });
  await service.connectApiKey(owner);
  assert.equal((await invoke("repositories.get")).full_name, "owner/project");
  const content = await invoke("contents.get", { path: "docs/read me.md", ref: "feature/docs" });
  assert.equal(Buffer.from(content.content, content.encoding).toString(), "Useful documentation");
  assert.equal(requests.at(-1).url.searchParams.get("ref"), "feature/docs");
  for (const operation of ["branches.list", "commits.list", "releases.list", "issues.list", "pulls.list", "issues.comments", "pulls.reviews"]) {
    const input = operation.endsWith("comments") || operation.endsWith("reviews") ? { number: 7 } : {};
    assert.equal((await invoke(operation, { ...input, page: 2, per_page: 10 })).length, 1);
    assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  }
  assert.equal((await invoke("workflows.runs")).workflow_runs[0].conclusion, "success");
  for (const operation of ["issues.get", "pulls.get"]) assert.equal((await invoke(operation, { number: 7 })).body, "Customer report");
  await invoke("issues.create", { title: "Fix checkout", body: "Customer report" });
  assert.equal(requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { title: "Fix checkout", body: "Customer report" });
  await invoke("pulls.create", { title: "Fix checkout", head: "fix/checkout", base: "main" });
  assert.equal(JSON.parse(requests.at(-1).init.body).draft, false);
  for (const operation of ["issues.update", "pulls.update"]) {
    assert.equal((await invoke(operation, { number: 7, state: "closed" })).state, "closed");
    assert.equal(requests.at(-1).init.method, "PATCH");
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), { state: "closed" });
  }
  const before = requests.length;
  for (const [operation, input] of [["contents.get", { path: "../secret" }], ["repositories.get", { owner: "other/owner" }], ["issues.list", { per_page: 101 }], ["issues.update", { number: 7 }], ["pulls.create", { title: "x", head: "x" }]]) await assert.rejects(invoke(operation, input));
  assert.equal(requests.length, before);
  malformed = true; await assert.rejects(invoke("issues.create", { title: "x" }), { code: "connector_response_invalid" }); malformed = false;
  for (const [httpStatus, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) { status = httpStatus; await assert.rejects(invoke("issues.create", { title: "x" }), { code }); }
  status = 200; fail = true; const failedBefore = requests.length;
  await assert.rejects(invoke("pulls.create", { title: "x", head: "fix", base: "main" }));
  assert.equal(requests.length, failedBefore + 1); fail = false;
  await service.disconnect(owner); const disconnected = requests.length;
  await assert.rejects(invoke("issues.get", { number: 7 })); assert.equal(requests.length, disconnected);
  await service.connectApiKey(owner); assert.equal((await invoke("issues.get", { number: 7 })).number, 7);
});
