import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
const MAX_TOKEN_AGE_SECONDS = 10 * 60;

class BackchannelLogoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackchannelLogoutError";
  }
}

/**
 * OpenID Connect Back-Channel Logout 1.0 for this app: the issuer posts a
 * signed logout_token and the matching app sessions end.
 */
function createBackchannelLogout({ config, store, issuer, fetchImpl = null, now = Date.now }) {
  let keySet = null;

  async function keys() {
    if (keySet) return keySet;
    const metadata = await issuer.serverMetadata();
    if (!metadata.jwks_uri) throw new BackchannelLogoutError("The issuer publishes no signing keys.");
    keySet = createRemoteJWKSet(new URL(metadata.jwks_uri), fetchImpl ? { [customFetch]: fetchImpl } : {});
    return keySet;
  }

  async function handle(logoutToken) {
    const token = String(logoutToken || "").trim();
    if (!token) throw new BackchannelLogoutError("logout_token is required.");
    const audience = await issuer.audiences();
    if (!audience.length) throw new BackchannelLogoutError("This app has no client at the issuer.");
    let payload;
    try {
      ({ payload } = await jwtVerify(token, await keys(), {
        issuer: config.issuer,
        audience,
        maxTokenAge: MAX_TOKEN_AGE_SECONDS,
        requiredClaims: ["iat", "jti"],
        currentDate: new Date(now())
      }));
    } catch {
      throw new BackchannelLogoutError("logout_token is not valid.");
    }
    const event = payload.events?.[BACKCHANNEL_LOGOUT_EVENT];
    if (!event || typeof event !== "object") {
      throw new BackchannelLogoutError("logout_token has no back-channel logout event.");
    }
    if (Object.hasOwn(payload, "nonce")) throw new BackchannelLogoutError("logout_token must not carry a nonce.");
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    const sid = typeof payload.sid === "string" ? payload.sid : "";
    if (!sub && !sid) throw new BackchannelLogoutError("logout_token names no subject or session.");
    const expiresAt = new Date((Number(payload.iat) + MAX_TOKEN_AGE_SECONDS) * 1000);
    if (!(await store.rememberLogoutToken(config.issuer, String(payload.jti), expiresAt))) {
      throw new BackchannelLogoutError("logout_token was already used.");
    }
    const ended = await store.revokeIssuerSessions(config.issuer, { sub, sid });
    return { ended: Number(ended) || 0 };
  }

  return Object.freeze({ handle });
}

export { BACKCHANNEL_LOGOUT_EVENT, BackchannelLogoutError, createBackchannelLogout };
