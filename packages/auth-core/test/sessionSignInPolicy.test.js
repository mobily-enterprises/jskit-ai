import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { authPolicyPlugin } from "../src/server/lib/index.js";

const SIGN_IN = Object.freeze({ at: "2026-11-23T09:00:00.000Z", ip: "203.0.113.7", userAgent: "Firefox/140.0", purpose: "normal" });
const CHANGED = Object.freeze({ password: "2026-11-20T09:00:00.000Z", email: "" });

/** A real Fastify app whose auth policy answers what the test sets, and a route that tells what the policy set. */
async function startApp(t) {
  const app = Fastify();
  t.after(() => app.close());
  let resolution = { authenticated: false, actor: null, transientFailure: false };
  await authPolicyPlugin({
    async resolveActor() {
      return resolution;
    },
    hasPermission: () => true
  }, { appEnv: "test" })(app);
  const facts = (request) => ({
    sessionSignIn: request.sessionSignIn,
    credentialsChangedAt: request.credentialsChangedAt,
    frozen: [Object.isFrozen(request.sessionSignIn), Object.isFrozen(request.credentialsChangedAt)]
  });
  app.get("/api/account/facts", { config: { authPolicy: "required" } }, (request) => facts(request));
  app.get("/api/public/facts", { config: { authPolicy: "public" } }, (request) => facts(request));
  return {
    answers(value) {
      resolution = value;
    },
    async read(url = "/api/account/facts") {
      const response = await app.inject({ method: "GET", url });
      return { status: response.statusCode, body: response.json() };
    }
  };
}

test("the auth policy sets request.sessionSignIn and request.credentialsChangedAt from the provider's answer", async (t) => {
  const app = await startApp(t);
  app.answers({ authenticated: true, actor: { id: 7 }, signIn: SIGN_IN, credentialsChangedAt: CHANGED, transientFailure: false });
  assert.deepEqual(await app.read(), {
    status: 200,
    body: { sessionSignIn: SIGN_IN, credentialsChangedAt: CHANGED, frozen: [true, true] }
  });

  // A field that is not text is unknown, "", so a check that asks for it refuses; nothing else is passed on.
  app.answers({
    authenticated: true,
    actor: { id: 7 },
    signIn: { at: "2026-11-23T09:00:00.000Z", ip: null, userAgent: 512, purpose: undefined, extra: "dropped" },
    credentialsChangedAt: { password: 0, extra: "dropped" },
    transientFailure: false
  });
  assert.deepEqual((await app.read()).body, {
    sessionSignIn: { at: "2026-11-23T09:00:00.000Z", ip: "", userAgent: "", purpose: "" },
    credentialsChangedAt: { password: "", email: "" },
    frozen: [true, true]
  });

  // A provider that keeps neither (OIDC, Supabase) leaves both null.
  app.answers({ authenticated: true, actor: { id: 7 }, transientFailure: false });
  assert.deepEqual((await app.read()).body, { sessionSignIn: null, credentialsChangedAt: null, frozen: [true, true] });
});

test("a signed-out request is refused before the route, and a public route signs nobody in", async (t) => {
  const app = await startApp(t);
  assert.equal((await app.read()).status, 401);
  app.answers({ authenticated: true, actor: { id: 7 }, signIn: SIGN_IN, credentialsChangedAt: CHANGED, transientFailure: false });
  assert.deepEqual((await app.read("/api/public/facts")).body, { sessionSignIn: null, credentialsChangedAt: null, frozen: [true, true] });
});
