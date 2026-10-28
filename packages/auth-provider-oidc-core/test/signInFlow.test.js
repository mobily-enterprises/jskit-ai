import assert from "node:assert/strict";
import test from "node:test";
import { startMockIssuer } from "../test-support/mockIssuer.js";
import { APP_ORIGIN, createRelyingParty, requestAt, signInAtIssuer } from "../test-support/harness.js";

test("an app signs in through a self-registered client and keeps its own session", async (t) => {
  const issuer = await startMockIssuer();
  const rp = await createRelyingParty({ issuer });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });

  const { started, input, request } = await signInAtIssuer(rp, { returnTo: "/projects" });
  const authorization = new URL(started.url);
  assert.equal(authorization.origin, issuer.issuer);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("redirect_uri"), `${APP_ORIGIN}/auth/login`);
  assert.ok(authorization.searchParams.get("nonce"));
  assert.equal(started.attempt.includes(authorization.searchParams.get("state")), false, "the attempt cookie is sealed");

  const result = await rp.service.oauthComplete(input, request);
  assert.equal(result.provider, "oidc");
  assert.equal(result.returnTo, "/projects");
  assert.equal(result.actor.provider, "oidc");
  assert.equal(result.actor.providerUserId, issuer.account.sub);
  assert.equal(result.actor.email, issuer.account.email);
  assert.equal(result.actor.displayName, issuer.account.name);

  const rows = await rp.knex("users").select("auth_provider", "auth_provider_user_sid", "email");
  assert.deepEqual(rows, [{ auth_provider: "oidc", auth_provider_user_sid: issuer.account.sub, email: issuer.account.email }]);
  assert.equal(result.actor.appUserId, "1");

  const signedIn = await rp.service.authenticateRequest(requestAt(APP_ORIGIN, { jskit_oidc_session: result.session.token }));
  assert.equal(signedIn.authenticated, true);
  assert.equal(signedIn.actor.email, issuer.account.email);

  await rp.service.logout(requestAt(APP_ORIGIN, { jskit_oidc_session: result.session.token }));
  const signedOut = await rp.service.authenticateRequest(requestAt(APP_ORIGIN, { jskit_oidc_session: result.session.token }));
  assert.equal(signedOut.authenticated, false);
  assert.equal(signedOut.clearSession, true);
});

test("a second sign-in reuses the origin's client and the same users row", async (t) => {
  const issuer = await startMockIssuer();
  const rp = await createRelyingParty({ issuer });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  for (let round = 0; round < 2; round += 1) {
    const { input, request } = await signInAtIssuer(rp);
    await rp.service.oauthComplete(input, request);
  }
  assert.equal((await rp.knex("auth_oidc_clients").count({ count: "*" }))[0].count, 1);
  assert.equal((await rp.knex("users").count({ count: "*" }))[0].count, 1);
});

test("each origin registers its own client", async (t) => {
  const issuer = await startMockIssuer();
  const rp = await createRelyingParty({ issuer });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  await rp.service.oauthStart({ provider: "oidc" }, requestAt("http://localhost:5173"));
  await rp.service.oauthStart({ provider: "oidc" }, requestAt("http://127.0.0.1:3000"));
  const clients = await rp.knex("auth_oidc_clients").orderBy("origin").pluck("origin");
  assert.deepEqual(clients, ["http://127.0.0.1:3000", "http://localhost:5173"]);
});

test("an address the hub blocked is explained", async (t) => {
  const issuer = await startMockIssuer({ blocked: true });
  const rp = await createRelyingParty({ issuer });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  await assert.rejects(
    rp.service.oauthStart({ provider: "oidc" }, requestAt()),
    { statusCode: 403, message: "Your accounts hub has blocked this app's address.", code: "auth.oidc.issuer.blocked" }
  );
  assert.equal((await rp.knex("auth_oidc_clients").count({ count: "*" }))[0].count, 0);
});

test("a wrong registration token is explained", async (t) => {
  const issuer = await startMockIssuer();
  const rp = await createRelyingParty({ issuer, env: { AUTH_OIDC_REGISTRATION_TOKEN: "not-the-token" } });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  await assert.rejects(rp.service.oauthStart({ provider: "oidc" }, requestAt()), {
    statusCode: 503,
    message: "Your accounts hub refused this app's registration token. Check AUTH_OIDC_REGISTRATION_TOKEN.",
    code: "auth.oidc.issuer.tokenRefused"
  });
});

test("a static client signs in without registration", async (t) => {
  const staticClient = {
    client_id: "static-app",
    client_secret: "static-app-secret-0123456789abcdef",
    redirect_uris: [`${APP_ORIGIN}/auth/login`],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_basic"
  };
  const issuer = await startMockIssuer({ staticClients: [staticClient] });
  const rp = await createRelyingParty({
    issuer,
    env: {
      AUTH_OIDC_REGISTRATION_TOKEN: "",
      AUTH_OIDC_CLIENT_ID: staticClient.client_id,
      AUTH_OIDC_CLIENT_SECRET: staticClient.client_secret
    }
  });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  const { started, input, request } = await signInAtIssuer(rp);
  assert.equal(new URL(started.url).searchParams.get("client_id"), "static-app");
  const result = await rp.service.oauthComplete(input, request);
  assert.equal(result.actor.email, issuer.account.email);
  assert.equal((await rp.knex("auth_oidc_clients").count({ count: "*" }))[0].count, 0);
});

test("logging out everywhere returns the issuer's end-session address", async (t) => {
  const issuer = await startMockIssuer();
  const rp = await createRelyingParty({ issuer });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  const { input, request } = await signInAtIssuer(rp);
  const { session } = await rp.service.oauthComplete(input, request);
  const cookies = { jskit_oidc_session: session.token };
  const destination = new URL(await rp.service.logoutEverywhere(requestAt(APP_ORIGIN, cookies), { everywhere: true }));
  assert.equal(destination.origin, issuer.issuer);
  assert.equal(destination.searchParams.get("post_logout_redirect_uri"), `${APP_ORIGIN}/`);
  assert.ok(destination.searchParams.get("id_token_hint"));
  assert.equal((await rp.service.authenticateRequest(requestAt(APP_ORIGIN, cookies))).authenticated, false);
  assert.equal(await rp.service.logoutEverywhere(requestAt(APP_ORIGIN, cookies), { everywhere: true }), "/");
});

test("a missing issuer leaves the app running and explains what to set", async (t) => {
  const issuer = await startMockIssuer();
  const rp = await createRelyingParty({ issuer, env: { AUTH_OIDC_ISSUER: "" } });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  await assert.rejects(rp.service.oauthStart({ provider: "oidc" }, requestAt()), {
    statusCode: 503,
    message: "Sign-in is not set up yet: AUTH_OIDC_ISSUER is missing.",
    code: "auth.oidc.setup.issuerMissing"
  });
});

test("preview identity signs in as an existing oidc users row only", async (t) => {
  const issuer = await startMockIssuer();
  const rp = await createRelyingParty({
    issuer,
    env: { AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: "preview-secret-0123456789abcdef" }
  });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  const previewRequest = { ...requestAt(), headers: { host: "localhost:5173", "x-jskit-dev-auth-secret": "preview-secret-0123456789abcdef" } };
  await assert.rejects(rp.service.devLoginAs(previewRequest, { email: issuer.account.email }), {
    message: "User not found.",
    code: "auth.dev.userNotFound",
    details: {
      fieldErrors: { email: "User not found." },
      fieldErrorCodes: { email: { code: "auth.dev.userNotFound", params: {} } }
    }
  });

  const { input, request } = await signInAtIssuer(rp);
  await rp.service.oauthComplete(input, request);
  const byEmail = await rp.service.devLoginAs(previewRequest, { email: issuer.account.email });
  assert.equal(byEmail.actor.providerUserId, issuer.account.sub);
  const bySubject = await rp.service.devLoginAs(previewRequest, { userId: issuer.account.sub });
  assert.equal(bySubject.actor.email, issuer.account.email);

  const signedIn = await rp.service.authenticateRequest({ ...previewRequest, cookies: { jskit_oidc_session: bySubject.session.token } });
  assert.equal(signedIn.authenticated, true);
  assert.equal(signedIn.sessionPurpose, "dev-auth");
  assert.equal(rp.service.getCapabilities().features.devLoginAs, true);
});
