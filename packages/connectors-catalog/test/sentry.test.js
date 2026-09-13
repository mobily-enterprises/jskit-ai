import assert from "node:assert/strict";
import test from "node:test";
import { sentryProvider, registerSentryClient } from "../src/server/sentry.js";

test("Sentry uses the same constrained resource for OAuth and MCP requests", () => {
  const settings = { organizationSlug: "example", projectSlug: "web-app" };
  const resource = sentryProvider.oauthResource(settings);
  assert.equal(resource, "https://mcp.sentry.dev/mcp/example/web-app");
  const request = sentryProvider.operations["tools.call"].request({ name: "get_issue_details", arguments: { issueId: "WEB-1" } }, settings);
  assert.equal(request.url, resource);
  assert.deepEqual(request.body, { method: "tools/call", params: { name: "get_issue_details", arguments: { issueId: "WEB-1" } } });
  for (const invalid of [{}, { organizationSlug: "../other" }, { organizationSlug: "example", projectSlug: "web?bypass=1" }]) {
    assert.throws(() => sentryProvider.oauthResource(invalid));
    assert.throws(() => sentryProvider.operations["tools.list"].request({}, invalid));
  }
});

test("Sentry registers only the declared callback and supported permissions", async () => {
  const requests = [];
  const options = { fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), init, body });
    return Response.json({ ...body, client_id: "project-client", client_secret: "private-client-secret" });
  } };
  const input = { clientName: "Debug project", callbackUrl: "https://app.example/integrations/sentry/callback", scopes: ["org:read"] };
  assert.deepEqual(await registerSentryClient(input, options), { clientId: "project-client", clientSecret: "private-client-secret" });
  assert.equal(requests[0].url, "https://mcp.sentry.dev/oauth/register");
  assert.deepEqual(requests[0].body.redirect_uris, [input.callbackUrl]);
  assert.equal(requests[0].body.scope, "org:read");
  assert.equal(requests[0].init.redirect, "error");
  for (const change of [{ callbackUrl: "https://app.example/callback#fragment" }, { scopes: ["admin:all"] }]) {
    await assert.rejects(registerSentryClient({ ...input, ...change }, options));
  }
  assert.equal(requests.length, 1);
});
