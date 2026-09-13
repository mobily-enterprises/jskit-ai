import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { gitlabApiProvider } from "../src/server/gitlab-api.js";

for (const perUser of [false, true]) test(`GitLab OAuth ${perUser ? "per-user non-expiring" : "shared rotating"} grants preserve protocol and ownership`, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "gitlab-oauth-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const callback = "https://example.test/integrations/gitlab-api/callback";
  const context = { applicationId: "app", subjectId: "owner" };
  const input = { context, integrationId: "gitlab" };
  let time = Date.now(), exchanges = 0;
  let tokenScope = "read_user read_api", apiStatus = 200;
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, registrations: { gitlab: { source: "own", clientId: "client", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK", tokenEndpointAuthMethod: "client_secret_post" } }, integrations: {
      gitlab: { provider: "gitlab-api", settings: { instanceUrl: "https://gitlab.example.test" }, accountMode: perUser ? "per-user" : "shared", scopes: ["read_user", "read_api"], authentication: { method: "oauth2", registrationRef: "gitlab" } },
      personal: { provider: "gitlab-api", settings: { instanceUrl: "https://gitlab.example.test" }, accountMode: "shared", scopes: ["read_user", "read_api"], authentication: { method: "api-key", secretRef: "env:TOKEN" } }
    } }, providers: [gitlabApiProvider], authorize: async owner => owner,
    store: createFileConnectionStore({ directory, protection }), now: () => time,
    resolveReference: async ref => ref === "env:CALLBACK" ? callback : ref === "env:TOKEN" ? "personal" : "secret",
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)), headers = new Headers(init.headers);
      assert.equal(url.origin, "https://gitlab.example.test");
      if (url.pathname === "/oauth/token") {
        assert.equal(url.pathname, "/oauth/token");
        assert.equal(headers.get("accept"), "application/json");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_secret"), "secret");
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback);
          assert.ok(body.get("code_verifier"));
        } else {
          assert.equal(body.get("refresh_token"), `refresh-${exchanges}`);
          assert.equal(body.get("redirect_uri"), callback);
        }
        exchanges++;
        if (perUser) return Response.json({ access_token: `access-${exchanges}`, token_type: "Bearer", scope: tokenScope });
        return Response.json({ access_token: `access-${exchanges}`, refresh_token: `refresh-${exchanges}`, token_type: "Bearer", expires_in: 60, scope: tokenScope });
      }
      assert.equal(url.origin, "https://gitlab.example.test");
      assert.ok(headers.get("authorization") === `Bearer access-${exchanges}` || headers.get("private-token") === "personal");
      if (apiStatus !== 200) return Response.json({ message: "private provider detail" }, { status: apiStatus });
      return Response.json({ id: 123, username: "fixture" });
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
  assert.equal(url.origin + url.pathname, "https://gitlab.example.test/oauth/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const returned = new URL(callback);
  returned.searchParams.set("code", "code");
  returned.searchParams.set("state", url.searchParams.get("state"));
  assert.equal((await service.completeAuthorization({ ...input, callbackUrl: returned.href })).status, "connected");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: returned.href }), { code: "connector_attempt_invalid" });
  time += 40_000;
  await Promise.all([service.invoke({ ...input, operation: "profile.read" }), service.invoke({ ...input, operation: "profile.read" })]);
  assert.equal(exchanges, perUser ? 1 : 2);
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  time += 40_000;
  await restarted.invoke({ ...input, operation: "profile.read" });
  assert.equal(exchanges, perUser ? 1 : 3);
  assert.equal((await restarted.connectApiKey({ context, integrationId: "personal" })).status, "connected");
  const otherApp = { context: { ...context, applicationId: "another-app" }, integrationId: "gitlab" };
  assert.equal((await restarted.status(otherApp)).status, "disconnected");
  if (perUser) {
    const otherUser = { context: { ...context, subjectId: "another-user" }, integrationId: "gitlab" };
    assert.equal((await restarted.status(otherUser)).status, "disconnected");
    await assert.rejects(restarted.invoke({ ...otherUser, operation: "profile.read" }));
    assert.equal((await restarted.status(input)).status, "connected");
  }
  const changedConfiguration = structuredClone(options.configuration);
  changedConfiguration.integrations.gitlab.settings.instanceUrl = "https://another-gitlab.example.test";
  const changed = createConnectionService({ ...options, configuration: changedConfiguration });
  assert.equal((await changed.status(input)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  for (const instanceUrl of ["http://gitlab.example.test", "https://name:secret@gitlab.example.test", "https://gitlab.example.test/subpath", "https://gitlab.example.test/?token=secret", "not-a-url"]) {
    changedConfiguration.integrations.gitlab.settings.instanceUrl = instanceUrl;
    assert.throws(() => createConnectionService({ ...options, configuration: changedConfiguration }), { code: "integration_configuration_invalid" });
  }
  await restarted.disconnect(input);
  assert.equal((await restarted.status(input)).status, "disconnected");
});


test("GitLab project paths, content and issue/MR writes use the selected host without replaying writes", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "gitlab-content-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = []; let status = 200, fail = false;
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { gitlab: { provider: "gitlab-api", settings: { instanceUrl: "https://code.example.test" }, accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:GITLAB_TOKEN" } } } },
    providers: [gitlabApiProvider], authorize: async owner => owner, resolveReference: async () => "private-token",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, init) => {
      const parsed = new URL(url); requests.push({ url: parsed, init });
      assert.equal(parsed.origin, "https://code.example.test");
      assert.equal(new Headers(init.headers).get("private-token"), "private-token");
      assert.equal(init.redirect, "error");
      if (fail) throw new Error("outcome unknown");
      if (status !== 200) return Response.json({ message: "private detail" }, { status });
      if (parsed.pathname === "/api/v4/user") return Response.json({ id: 1, username: "owner" });
      assert.ok(parsed.pathname.startsWith("/api/v4/projects/team%2Fsubgroup%2Fproject"));
      if (parsed.pathname.endsWith("/repository/files/docs%2Fread%20me.md")) return Response.json({ file_path: "docs/read me.md", encoding: "base64", content: Buffer.from("Useful documentation").toString("base64") });
      if (parsed.pathname.endsWith("team%2Fsubgroup%2Fproject")) return Response.json({ id: 1, path_with_namespace: "team/subgroup/project" });
      if (init.method !== "GET") return Response.json({ iid: 7, title: "Fix checkout", ...JSON.parse(init.body) });
      if (/\/(issues|merge_requests)\/7$/.test(parsed.pathname)) return Response.json({ iid: 7, title: "Fix checkout", description: "Customer report" });
      return Response.json([{ id: 3, body: "Review comment", status: "success" }]);
    }
  });
  const owner = { context: { applicationId: "repo-app", subjectId: "owner" }, integrationId: "gitlab" };
  const invoke = (operation, input = {}) => service.invoke({ ...owner, operation, input: { project: "team/subgroup/project", ...input } });
  await service.connectApiKey(owner);
  assert.equal((await invoke("projects.get")).path_with_namespace, "team/subgroup/project");
  const file = await invoke("files.get", { filePath: "docs/read me.md", ref: "feature/docs" });
  assert.equal(Buffer.from(file.content, file.encoding).toString(), "Useful documentation");
  assert.equal(requests.at(-1).url.searchParams.get("ref"), "feature/docs");
  for (const operation of ["branches.list", "commits.list", "pipelines.list", "issues.list", "mergeRequests.list", "issues.notes", "mergeRequests.notes"]) {
    assert.equal((await invoke(operation, { ...(operation.endsWith("notes") ? { iid: 7 } : {}), page: 2, per_page: 10 })).length, 1);
    assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  }
  for (const operation of ["issues.get", "mergeRequests.get"]) assert.equal((await invoke(operation, { iid: 7 })).description, "Customer report");
  await invoke("issues.create", { title: "Fix checkout", description: "Customer report" });
  assert.equal(requests.at(-1).url.pathname, "/api/v4/projects/team%2Fsubgroup%2Fproject/issues");
  assert.equal(requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { title: "Fix checkout", description: "Customer report" });
  await invoke("mergeRequests.create", { title: "Fix checkout", source_branch: "fix/checkout", target_branch: "main" });
  assert.equal(JSON.parse(requests.at(-1).init.body).source_branch, "fix/checkout");
  for (const operation of ["issues.update", "mergeRequests.update"]) {
    assert.equal((await invoke(operation, { iid: 7, state_event: "close" })).state_event, "close");
    assert.equal(requests.at(-1).init.method, "PUT");
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), { state_event: "close" });
  }
  const before = requests.length;
  for (const [operation, input] of [["files.get", { filePath: "../secret", ref: "main" }], ["projects.get", { project: "team/../another" }], ["issues.list", { per_page: 101 }], ["issues.update", { iid: 7 }], ["mergeRequests.create", { title: "x", source_branch: "fix" }]]) await assert.rejects(invoke(operation, input));
  assert.equal(requests.length, before);
  for (const [httpStatus, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) { status = httpStatus; await assert.rejects(invoke("issues.create", { title: "x" }), { code }); }
  status = 200; fail = true; const failedBefore = requests.length;
  await assert.rejects(invoke("issues.create", { title: "x" })); assert.equal(requests.length, failedBefore + 1); fail = false;
  await service.disconnect(owner); const disconnected = requests.length;
  await assert.rejects(invoke("issues.get", { iid: 7 })); assert.equal(requests.length, disconnected);
  await service.connectApiKey(owner); assert.equal((await invoke("issues.get", { iid: 7 })).iid, 7);
});
