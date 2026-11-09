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

test("ending every session reads only the approved apps and sends their logout tokens at once", async (t) => {
  // Each app answers only once both tokens have arrived, or after 2 seconds: one at a time, the first waits it out.
  let inFlight = 0;
  let mostAtOnce = 0;
  let bothArrived;
  const arrivals = new Promise((resolve) => { bothArrived = resolve; });
  const slow = Fastify({ logger: false, forceCloseConnections: true });
  slow.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => done(null, body));
  slow.post("/api/auth/oidc/backchannel-logout", async (_request, reply) => {
    inFlight += 1;
    mostAtOnce = Math.max(mostAtOnce, inFlight);
    if (inFlight === 2) bothArrived();
    await Promise.race([arrivals, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    inFlight -= 1;
    return reply.code(200).send();
  });
  await slow.listen({ port: 0, host: "127.0.0.1" });
  t.after(() => slow.close());
  const origin = `http://127.0.0.1:${slow.server.address().port}`;
  await registerApp(hub.url, { origin, name: "One" });
  await registerApp(hub.url, { origin, name: "Two" });
  const waiting = await registerApp(hub.url, { origin: "https://waiting.example.test", name: "Waiting" });
  assert.equal(waiting.response.headers.get("x-hub-client-status"), "pending");
  const owner = createBrowser();
  await owner.api(`${hub.url}/hub/api/sign-in`, { body: { email: OWNER_EMAIL, password: PASSWORD } });
  const { body: { account } } = await createAccount(createBrowser(), hub.url, { email: "grace@example.test", password: PASSWORD });

  const statements = [];
  const record = ({ sql }) => statements.push(sql);
  hub.knex.on("query", record);
  let disabled;
  try {
    disabled = await owner.api(`${hub.url}/hub/api/admin/people/${account.id}/disable`, { body: {} });
  } finally {
    hub.knex.off("query", record);
  }
  assert.equal(disabled.status, 200);
  assert.equal(mostAtOnce, 2, "Both apps' logout tokens are in flight at once");
  const appReads = statements.filter((sql) => /oidc_issuer_clients/u.test(sql) && /^select/iu.test(sql));
  assert.equal(appReads.length, 1, appReads.join("\n"));
  assert.match(appReads[0], /`status` in \(/u, "The approved apps are chosen by status in SQL");
});
