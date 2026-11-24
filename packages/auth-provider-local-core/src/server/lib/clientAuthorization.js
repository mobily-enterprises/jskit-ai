import { timingSafeEqual } from "node:crypto";
import { ClientAuthorizationError } from "@jskit-ai/auth-core/server/clientAuthorizationError";
import { buildSessionPayload, CLIENT_SESSION_PREFIX } from "./sessions.js";
import { isExpiredIso, randomToken, sha256Base64url, signToken, verifySignedToken } from "./tokens.js";

// Local auth as an OAuth 2.1 authorization server for the applications config.auth.clients names, such as an
// assistant that works in this app for the people who connect it. A person signed in to the app allows a client on
// the consent page, the client exchanges the code it is given (PKCE, S256) for a 15-minute access token and a refresh
// token, and calls the routes that take a bearer token (credentials: "bearer") as that person, with that person's
// rights. The connection is one ordinary session of the person (purpose "client.<id>"), so revoking it, signing out
// of every other session, a password change or disabling the account ends it from the next call. A client never
// gets a browser session: cookie authentication refuses client sessions, and bearer routes refuse browser ones.

const CODE_PURPOSE = "client-code";
const CONSENT_PURPOSE = "client-consent";
const CODE_TTL_SECONDS = 60;
const CONSENT_TTL_SECONDS = 10 * 60;
const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,24}$/u;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const STATE_MAX_LENGTH = 512;
const SECRET_MIN_LENGTH = 32;
const LOCAL_HOSTS = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);

const nowSeconds = () => Math.floor(Date.now() / 1000);
const text = (value) => (typeof value === "string" ? value.trim() : "");

function redirectUriProblem(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "is not an absolute URL";
  }
  if (url.hash) return "has a fragment";
  if (url.protocol === "https:") return "";
  return url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname) ? "" : "must use https (http only on localhost)";
}

/**
 * The clients an application allows to connect, from config.auth.clients: `{ <id>: { name, redirectUris, secret? } }`.
 * A client with a secret authenticates with it at the token endpoint (client_secret_post); one without is a public
 * client, held by PKCE alone. Anything else stops startup with what to fix.
 * @param {unknown} value
 * @returns {ReadonlyArray<Readonly<{ id: string, name: string, redirectUris: ReadonlyArray<string>, secret: string }>>}
 */
function resolveAuthorizationClients(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("config.auth.clients maps each client id to { name, redirectUris, secret? }.");
  }
  return Object.freeze(Object.entries(value).map(([id, client]) => {
    const label = `config.auth.clients.${id}`;
    if (!CLIENT_ID_PATTERN.test(id)) {
      throw new TypeError(`${label}: a client id is 1 to 25 lowercase letters, digits and dashes, starting with a letter or digit.`);
    }
    if (!client || typeof client !== "object" || Array.isArray(client)) throw new TypeError(`${label} must be an object.`);
    const name = text(client.name);
    if (!name || name.length > 80) throw new TypeError(`${label}.name must be the client's name, at most 80 characters.`);
    const redirectUris = client.redirectUris;
    if (!Array.isArray(redirectUris) || redirectUris.length < 1) {
      throw new TypeError(`${label}.redirectUris must list the client's redirect URIs.`);
    }
    for (const uri of redirectUris) {
      const problem = typeof uri === "string" ? redirectUriProblem(uri) : "is not a string";
      if (problem) throw new TypeError(`${label}.redirectUris: ${JSON.stringify(uri)} ${problem}.`);
    }
    if (Object.hasOwn(client, "secret") && (typeof client.secret !== "string" || client.secret.length < SECRET_MIN_LENGTH)) {
      throw new TypeError(`${label}.secret must be at least ${SECRET_MIN_LENGTH} characters; leave it out for a public client.`);
    }
    return Object.freeze({ id, name, redirectUris: Object.freeze([...redirectUris]), secret: client.secret || "" });
  }));
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createClientAuthorization({ backend, config, sessions }) {
  const clients = new Map(config.clients.map((client) => [client.id, client]));
  const issuer = new URL(config.appPublicUrl).origin;
  const secret = config.sessionSecret;
  const purposeOf = (client) => `${CLIENT_SESSION_PREFIX}${client.id}`;

  function redirectTo(redirectUri, params) {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries({ ...params, iss: issuer })) {
      if (value) url.searchParams.set(name, value);
    }
    return { kind: "redirect", to: url.href };
  }

  /** The authorization server metadata (RFC 8414), or null while no client is configured. */
  function metadata() {
    if (!clients.size) return null;
    const methods = new Set([...clients.values()].map((client) => (client.secret ? "client_secret_post" : "none")));
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      revocation_endpoint: `${issuer}/api/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [...methods],
      revocation_endpoint_auth_methods_supported: [...methods],
      authorization_response_iss_parameter_supported: true
    };
  }

  /** The signed-in person's normal session, or null. */
  async function signedInPerson(request) {
    const result = await sessions.authenticateRequest(request);
    return result.authenticated === true && result.sessionPurpose === "normal" ? result : null;
  }

  /**
   * An authorization request (the query of GET /oauth/authorize) as the consent page shows it. Without a known client
   * and one of its redirect URIs nothing is redirected anywhere (`refused`); another mistake goes back to the client
   * as an OAuth error. A person not signed in is sent to sign in first (`sign-in`).
   * @param {Record<string, unknown>} query
   * @param {object} request
   */
  async function startAuthorization(query, request) {
    const client = clients.get(text(query.client_id));
    if (!client) return { kind: "refused", reason: "unknownClient" };
    const redirectUri = text(query.redirect_uri);
    if (!client.redirectUris.includes(redirectUri)) return { kind: "refused", reason: "unknownRedirect" };
    const state = text(query.state);
    const back = (error, description) => redirectTo(redirectUri, { error, error_description: description, state });
    if (state.length > STATE_MAX_LENGTH) return back("invalid_request", `state is longer than ${STATE_MAX_LENGTH} characters.`);
    if (text(query.response_type) !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
    if (text(query.code_challenge_method) !== "S256" || !CODE_CHALLENGE_PATTERN.test(text(query.code_challenge))) {
      return back("invalid_request", "PKCE is required: code_challenge with code_challenge_method=S256.");
    }
    const resource = text(query.resource);
    if (resource && (!URL.canParse(resource) || new URL(resource).origin !== issuer)) {
      return back("invalid_target", "resource is not an address on this server.");
    }
    const person = await signedInPerson(request);
    if (!person) return { kind: "sign-in" };
    const iat = nowSeconds();
    const ticket = signToken({
      purpose: CONSENT_PURPOSE,
      ses: person.sessionId,
      client: client.id,
      redirect: redirectUri,
      challenge: text(query.code_challenge),
      state,
      iat,
      exp: iat + CONSENT_TTL_SECONDS
    }, secret);
    return {
      kind: "consent",
      client: { id: client.id, name: client.name },
      // Where the person's answer is sent on to, which the page's form may lead to.
      returnsTo: new URL(redirectUri).origin,
      person: { email: person.actor.email, displayName: person.actor.displayName || "" },
      ticket
    };
  }

  /**
   * The person's answer on the consent page: a code for the client when they allowed it, access_denied otherwise.
   * The ticket is the consent page's own, signed for the session that saw it, so no other page or session can answer.
   * @param {{ ticket?: unknown, allow?: boolean }} input
   * @param {object} request
   */
  async function decideAuthorization({ ticket, allow }, request) {
    const consent = verifySignedToken(text(ticket), secret);
    const client = consent?.purpose === CONSENT_PURPOSE ? clients.get(consent.client) : null;
    if (!client || !client.redirectUris.includes(consent.redirect)) return { kind: "refused", reason: "expiredConsent" };
    const person = await signedInPerson(request);
    if (!person || person.sessionId !== consent.ses) return { kind: "refused", reason: "otherSession" };
    if (allow !== true) return redirectTo(consent.redirect, { error: "access_denied", state: consent.state });
    const iat = nowSeconds();
    const code = signToken({
      purpose: CODE_PURPOSE,
      sub: person.actor.providerUserId,
      client: client.id,
      redirect: consent.redirect,
      challenge: consent.challenge,
      iat,
      exp: iat + CODE_TTL_SECONDS,
      jti: randomToken(18)
    }, secret);
    return redirectTo(consent.redirect, { code, state: consent.state });
  }

  /** The client a token or revocation request names, authenticated by its secret when it has one. */
  function authenticatedClient(form) {
    const client = clients.get(text(form.client_id));
    if (!client || (client.secret && !sameSecret(form.client_secret, client.secret))) {
      throw new ClientAuthorizationError("invalid_client", "The client is unknown or its secret is wrong.", 401);
    }
    return client;
  }

  async function exchangeCode(form, client, request) {
    const invalidGrant = (description) => new ClientAuthorizationError("invalid_grant", description);
    const code = verifySignedToken(text(form.code), secret);
    if (code?.purpose !== CODE_PURPOSE || code.client !== client.id) throw invalidGrant("The code is unknown, expired or not this client's.");
    if (text(form.redirect_uri) !== code.redirect) throw invalidGrant("redirect_uri is not the authorization request's.");
    const verifier = text(form.code_verifier);
    if (!CODE_VERIFIER_PATTERN.test(verifier) || sha256Base64url(verifier) !== code.challenge) {
      throw invalidGrant("code_verifier does not match the code challenge.");
    }
    // The session's id comes from the code, so a code makes at most one session: a second use finds it, revokes it
    // (RFC 6749 section 4.1.2) and is refused, and of two at once the second insert fails on the session's id.
    const sessionId = `ses_${sha256Base64url(`${CODE_PURPOSE}:${code.jti}`)}`;
    let outcome;
    try {
      outcome = await backend.withTransaction(async (tx) => {
        if (await tx.sessions.findById(sessionId)) {
          await tx.sessions.revoke(sessionId);
          return { used: true };
        }
        const user = await tx.users.findById(String(code.sub));
        if (!user || user.disabled) return { user: null };
        return { user, session: await sessions.createSessionForUser(tx, user, { id: sessionId, purpose: purposeOf(client), request }) };
      });
    } catch (error) {
      if (await backend.withTransaction((tx) => tx.sessions.findById(sessionId))) throw invalidGrant("The code was already used.");
      throw error;
    }
    if (outcome.used) throw invalidGrant("The code was already used.");
    if (!outcome.user) throw invalidGrant("The code's account cannot sign in.");
    sessions.recordSignInEvent("signedIn", { method: "client", client: client.id, userId: outcome.user.id, email: outcome.user.email }, request);
    return outcome.session;
  }

  async function refresh(form, client) {
    const refreshToken = text(form.refresh_token);
    const tokenHash = sha256Base64url(refreshToken);
    const found = refreshToken
      ? await backend.withTransaction(async (tx) => {
        const session = await tx.sessions.findByTokenHash(tokenHash);
        if (!session || session.revokedAt || isExpiredIso(session.expiresAt) || session.purpose !== purposeOf(client)) return null;
        const user = await tx.users.findById(session.userId);
        return user && !user.disabled ? { user, session } : null;
      })
      : null;
    if (!found) throw new ClientAuthorizationError("invalid_grant", "The refresh token is unknown, revoked or expired.");
    return buildSessionPayload({ ...found, refreshToken, secret });
  }

  /**
   * The token endpoint (RFC 6749 section 3.2): an authorization code or a refresh token for an access token.
   * @param {Record<string, unknown>} form
   * @param {object | null} [request] Where the new session is first seen from.
   */
  async function exchangeToken(form, request = null) {
    const client = authenticatedClient(form);
    const grantType = text(form.grant_type);
    let tokens;
    if (grantType === "authorization_code") tokens = await exchangeCode(form, client, request);
    else if (grantType === "refresh_token") tokens = await refresh(form, client);
    else throw new ClientAuthorizationError("unsupported_grant_type", "grant_type is authorization_code or refresh_token.");
    return {
      access_token: tokens.access_token,
      token_type: "Bearer",
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token
    };
  }

  /**
   * Token revocation (RFC 7009): a client's refresh or access token ends its session. A token that is unknown, or
   * another client's, is answered the same, so the answer tells nothing about it.
   * @param {Record<string, unknown>} form
   */
  async function revokeToken(form) {
    const client = authenticatedClient(form);
    const token = text(form.token);
    if (!token) throw new ClientAuthorizationError("invalid_request", "token is required.");
    const access = verifySignedToken(token, secret);
    await backend.withTransaction(async (tx) => {
      const session = access?.sid
        ? await tx.sessions.findById(String(access.sid))
        : await tx.sessions.findByTokenHash(sha256Base64url(token));
      if (session && session.purpose === purposeOf(client) && !session.revokedAt) await tx.sessions.revoke(session.id);
    });
  }

  return Object.freeze({ metadata, startAuthorization, decideAuthorization, exchangeToken, revokeToken });
}

export { createClientAuthorization, resolveAuthorizationClients };
