import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createAccount, createBrowser, registerApp, signInThroughHub } from "./support/browser.js";
import { OWNER_EMAIL, startHub } from "./support/hub.js";

const PASSWORD = "correct horse battery staple";
let hub;
let app;
const received = [];

before(async () => {
  app = Fastify({ logger: false, forceCloseConnections: true });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body)));
  });
  app.post("/api/auth/oidc/backchannel-logout", async (request, reply) => {
    received.push(request.body.logout_token);
    return reply.code(200).send();
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  hub = await startHub();
});

after(async () => {
  await hub?.stop();
  await app?.close();
});

test("disabling an account sends a signed logout token to approved apps", async () => {
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const client = (await registerApp(hub.url, { origin })).body;
  const owner = createBrowser();
  await createAccount(owner, hub.url, { email: OWNER_EMAIL, password: PASSWORD });
  await owner.api(`${hub.url}/hub/api/email/confirm`, { body: { token: new URL(hub.mailer.lastLink()).searchParams.get("token") } });
  const { body: { account } } = await createAccount(createBrowser(), hub.url, { email: "ada@example.test", password: PASSWORD });
  await signInThroughHub(createBrowser(), hub.url, client, { email: "ada@example.test", password: PASSWORD });

  const disabled = await owner.api(`${hub.url}/hub/api/admin/people/${account.id}/disable`, { body: {} });
  assert.equal(disabled.status, 200);
  assert.equal(received.length, 1);
  const { payload } = await jwtVerify(received[0], createRemoteJWKSet(new URL(`${hub.url}/oidc/jwks`)), {
    issuer: hub.url,
    audience: client.client_id
  });
  assert.equal(payload.sub, account.id);
  assert.ok(payload.jti);
  assert.equal(payload.nonce, undefined);
  assert.deepEqual(payload.events, { "http://schemas.openid.net/event/backchannel-logout": {} });

  const blocked = await createBrowser().api(`${hub.url}/hub/api/sign-in`, { body: { email: "ada@example.test", password: PASSWORD } });
  assert.equal(blocked.status, 401, "a disabled account cannot sign in");
});
