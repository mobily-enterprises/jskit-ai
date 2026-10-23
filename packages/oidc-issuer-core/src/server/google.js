import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomToken } from "./crypto.js";

const GOOGLE_ENDPOINTS = Object.freeze({
  issuer: "https://accounts.google.com",
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs"
});
const STATE_KIND = "GoogleState";
const STATE_TTL_SECONDS = 600;

/**
 * "Continue with Google" with the owner's own Google OAuth client. The hub
 * is an ordinary Google relying party: authorization code, PKCE, state bound
 * to the browser, nonce, and a verified ID token.
 */
function createGoogleSignIn({ google, issuer, Adapter, endpoints = GOOGLE_ENDPOINTS, fetchImpl = globalThis.fetch }) {
  const states = new Adapter(STATE_KIND);
  const jwks = createRemoteJWKSet(new URL(endpoints.jwks));
  const redirectUri = `${issuer}/hub/google/callback`;

  return Object.freeze({
    redirectUri,

    /** Returns the Google address and the state to bind to the browser. */
    async start({ intent, uid = null, accountId = null }) {
      const state = randomToken(24);
      const nonce = randomToken(24);
      const codeVerifier = randomToken(48);
      await states.upsert(state, { intent, uid, accountId, nonce, codeVerifier }, STATE_TTL_SECONDS);
      const url = new URL(endpoints.authorization);
      url.search = new URLSearchParams({
        client_id: google.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
        code_challenge_method: "S256",
        prompt: "select_account"
      }).toString();
      return { url: url.toString(), state };
    },

    /** Exchanges the code and returns Google's verified identity and the stored intent. */
    async finish({ code, state, browserState }) {
      if (!state || state !== browserState) return null;
      const stored = await states.find(state);
      await states.destroy(state);
      if (!stored || !code) return null;
      const response = await fetchImpl(endpoints.token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          code_verifier: stored.codeVerifier
        })
      });
      if (!response.ok) return null;
      const { id_token: idToken } = await response.json();
      const { payload } = await jwtVerify(String(idToken || ""), jwks, {
        issuer: [endpoints.issuer, endpoints.issuer.replace(/^https:\/\//u, "")],
        audience: google.clientId
      });
      if (payload.nonce !== stored.nonce || !payload.sub) return null;
      return {
        intent: stored.intent,
        uid: stored.uid,
        accountId: stored.accountId,
        identity: {
          sub: String(payload.sub),
          email: String(payload.email || "").toLowerCase(),
          emailVerified: payload.email_verified === true,
          name: String(payload.name || "")
        }
      };
    }
  });
}

export { GOOGLE_ENDPOINTS, createGoogleSignIn };
