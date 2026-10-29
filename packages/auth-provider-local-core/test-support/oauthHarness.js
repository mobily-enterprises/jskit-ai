import { createHash } from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { followAuthorization, startMockIssuer } from "../../auth-provider-oidc-core/test-support/mockIssuer.js";
import { createLocalAuthService } from "../src/server/lib/service.js";

const APP_URL = "http://localhost:5173";
const REDIRECT_URI = `${APP_URL}/auth/login`;
const ATTEMPT_COOKIE = "jskit_local_oauth_attempt";
const CLIENT = Object.freeze({ clientId: "local-app", clientSecret: "local-app-secret-0123456789abcdef" });

/** A local OpenID Connect provider (Google or Microsoft stand-in) with this app as its static client. */
async function startOidcProvider({ account } = {}) {
  return startMockIssuer({
    account,
    staticClients: [{
      client_id: CLIENT.clientId,
      client_secret: CLIENT.clientSecret,
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post"
    }]
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

/**
 * GitHub's OAuth 2.0 endpoints and the two API reads sign-in makes. The token
 * endpoint checks the client secret, redirect address and PKCE verifier.
 */
async function startFakeGitHub({ user = { id: 4242, login: "ada", name: "Ada Lovelace" }, emails } = {}) {
  const grants = new Map();
  const accessToken = "gho_fake_access_token";
  const state = {
    user,
    emails: emails || [{ email: "ada@example.test", primary: true, verified: true }]
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://github.test");
    const json = (status, body) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/login/oauth/authorize") {
      const code = `gh_code_${grants.size + 1}`;
      grants.set(code, {
        challenge: url.searchParams.get("code_challenge"),
        redirectUri: url.searchParams.get("redirect_uri")
      });
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state"));
      res.statusCode = 302;
      res.setHeader("location", back.href);
      res.end();
      return;
    }
    if (url.pathname === "/login/oauth/access_token" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const grant = grants.get(form.get("code"));
      grants.delete(form.get("code"));
      const verifierMatches = grant &&
        createHash("sha256").update(form.get("code_verifier") || "").digest("base64url") === grant.challenge;
      if (!grant || !verifierMatches || form.get("client_secret") !== CLIENT.clientSecret ||
          form.get("redirect_uri") !== grant.redirectUri) {
        json(400, { error: "bad_verification_code" });
        return;
      }
      json(200, { access_token: accessToken, token_type: "bearer", scope: "read:user,user:email" });
      return;
    }
    if (req.headers.authorization !== `Bearer ${accessToken}`) {
      json(401, { message: "Bad credentials" });
      return;
    }
    if (url.pathname === "/user") {
      json(200, state.user);
      return;
    }
    if (url.pathname === "/user/emails") {
      json(200, state.emails);
      return;
    }
    json(404, { message: "Not Found" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    provider: {
      id: "github",
      label: "GitHub",
      ...CLIENT,
      authorizationEndpoint: `${origin}/login/oauth/authorize`,
      tokenEndpoint: `${origin}/login/oauth/access_token`,
      apiUrl: origin
    },
    async close() {
      server.closeAllConnections?.();
      server.close();
      await once(server, "close");
    }
  };
}

function oidcProviderEntry(issuer, { id = "google", label = "Google" } = {}) {
  return { id, label, ...CLIENT, issuer: issuer.issuer };
}

function createService({ backend, oauthProviders, profileProjector = null }) {
  return createLocalAuthService({
    backend,
    profileProjector,
    config: {
      sessionSecret: "oauth-test-session-secret",
      nodeEnv: "test",
      appPublicUrl: APP_URL,
      oauthProviders
    }
  });
}

function sessionCookies(session) {
  return { jskit_local_access_token: session.access_token, jskit_local_refresh_token: session.refresh_token };
}

/**
 * Starts a sign-in (or, with `link`, a link for the signed-in `cookies`), lets
 * the provider approve it, and returns the callback input and browser request.
 */
async function approveAtProvider(service, { provider = "google", returnTo = "/home", cookies = {}, link = false } = {}) {
  const started = link
    ? await service.startProviderLink({ cookies }, { provider, returnTo })
    : await service.oauthStart({ provider, returnTo });
  const callback = await followAuthorization(started.url, { redirectPrefix: REDIRECT_URI });
  return {
    started,
    input: {
      provider,
      code: callback.searchParams.get("code"),
      state: callback.searchParams.get("state"),
      iss: callback.searchParams.get("iss") || undefined
    },
    request: { cookies: { ...cookies, [ATTEMPT_COOKIE]: started.attempt } }
  };
}

export {
  APP_URL,
  ATTEMPT_COOKIE,
  approveAtProvider,
  createService,
  oidcProviderEntry,
  sessionCookies,
  startFakeGitHub,
  startOidcProvider
};
