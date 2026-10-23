import http from "node:http";
import { once } from "node:events";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import Provider from "oidc-provider";

const REGISTRATION_TOKEN = "test-registration-token-0123456789abcdef";
const ACCOUNT = Object.freeze({ sub: "usr_test_ada", email: "ada@example.test", name: "Ada Lovelace" });

/**
 * A local OpenID Connect issuer (plain oidc-provider) that signs a fixed test
 * account in without a form, with registration, back-channel and RP-initiated
 * logout enabled. No real provider is ever contacted.
 */
async function startMockIssuer({ blocked = false, account = ACCOUNT, staticClients = [] } = {}) {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const issuer = `http://127.0.0.1:${server.address().port}`;
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const signingJwk = { ...(await exportJWK(privateKey)), kid: "test-key", alg: "RS256", use: "sig" };

  const provider = new Provider(issuer, {
    clients: staticClients,
    findAccount: async (_ctx, sub) => ({
      accountId: sub,
      claims: async () => ({ sub, email: account.email, email_verified: account.emailVerified ?? true, name: account.name })
    }),
    claims: { openid: ["sub"], email: ["email", "email_verified"], profile: ["name"] },
    cookies: { keys: ["mock-issuer-cookie-key"] },
    jwks: { keys: [signingJwk] },
    pkce: { required: () => true },
    responseTypes: ["code"],
    ttl: { AccessToken: 600, AuthorizationCode: 60, Grant: 600, IdToken: 600, Interaction: 600, Session: 600 },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, initialAccessToken: REGISTRATION_TOKEN },
      registrationManagement: { enabled: true },
      backchannelLogout: { enabled: true },
      rpInitiatedLogout: { enabled: true }
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` }
  });
  const callback = provider.callback();

  // Signs the test account in and grants the requested scopes, no form.
  async function finishInteraction(req, res) {
    const details = await provider.interactionDetails(req, res);
    const grant = new provider.Grant({ accountId: account.sub, clientId: details.params.client_id });
    grant.addOIDCScope(String(details.params.scope || "openid"));
    const grantId = await grant.save();
    await provider.interactionFinished(req, res, { login: { accountId: account.sub }, consent: { grantId } }, {
      mergeWithLastSubmission: false
    });
  }

  server.on("request", (req, res) => {
    // An accounts hub answers a blocked address's registration like this.
    if (blocked && req.method === "POST" && req.url.startsWith("/reg")) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "invalid_redirect_uri", error_description: "This address is blocked by the hub's owner." }));
      return;
    }
    if (req.url.startsWith("/interaction/")) {
      finishInteraction(req, res).catch((error) => {
        res.statusCode = 500;
        res.end(String(error?.message || error));
      });
      return;
    }
    callback(req, res);
  });

  return {
    issuer,
    account,
    provider,
    registrationToken: REGISTRATION_TOKEN,
    // Signs any claims with the issuer's key: tampered ID tokens and logout tokens.
    sign(claims, { typ = "JWT" } = {}) {
      return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key", typ }).sign(privateKey);
    },
    async close() {
      server.closeAllConnections?.();
      server.close();
      await once(server, "close");
    }
  };
}

/**
 * Follows the browser part of an authorization request with a cookie jar,
 * and returns the callback address the issuer sent the browser back to.
 */
async function followAuthorization(url, { redirectPrefix }) {
  const jar = new Map();
  let next = url;
  for (let hop = 0; hop < 10; hop += 1) {
    if (next.startsWith(redirectPrefix)) return new URL(next);
    const response = await fetch(next, {
      redirect: "manual",
      headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") }
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    const location = response.headers.get("location");
    if (!location) throw new Error(`Authorization stopped at ${next} with ${response.status}: ${await response.text()}`);
    next = new URL(location, next).href;
  }
  throw new Error("Authorization redirected too many times.");
}

export { ACCOUNT, REGISTRATION_TOKEN, followAuthorization, startMockIssuer };
