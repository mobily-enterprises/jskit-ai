import { createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { PASS_TEXTS, createPassError } from "./passTexts.js";

// A one-time sign-in pass: a short-lived token a trusted issuer signs with its Ed25519 key, naming one person
// (`sub`), the application it is for (`aud`), one resource of that application (`resource`) and its own id (`jti`),
// which the application records as used. It is a compact JWS (RFC 7515) with the EdDSA algorithm (RFC 8037), so any
// JOSE library can issue one; the `typ` header keeps it from passing for another token the same key signs.
const PASS_TYPE = "pass+jwt";
const PASS_ALGORITHM = "EdDSA";
// How long signPass makes a pass last, and the longest lifetime verifyPass accepts.
const PASS_LIFETIME_SECONDS = 60;
const PASS_MAX_LIFETIME_SECONDS = 300;
// How far the issuer's clock may differ from the application's.
const PASS_CLOCK_SKEW_SECONDS = 30;
// Bounds on what a pass may hold, so a forged one costs little to refuse.
const PASS_MAX_LENGTH = 4096;
const PASS_MAX_TEXT_CLAIM_LENGTH = 255;

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseBase64urlJson(part) {
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isClaimText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= PASS_MAX_TEXT_CLAIM_LENGTH;
}

function isClaimSeconds(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * The issuer's Ed25519 public key from its text: a PEM block, or the base64 of its DER SubjectPublicKeyInfo (the PEM
 * body on one line, which fits an environment variable).
 * @param {string} text
 */
function readPassPublicKey(text) {
  const value = String(text || "").trim();
  let key;
  try {
    key = value.startsWith("-----BEGIN")
      ? createPublicKey(value)
      : createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
  } catch (error) {
    throw new Error(`AUTH_PASS_PUBLIC_KEY is not a public key: ${error.message}`);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("AUTH_PASS_PUBLIC_KEY must be an Ed25519 public key.");
  }
  return key;
}

/**
 * Pass sign-in's settings from the environment: AUTH_PASS_PUBLIC_KEY, the issuer's Ed25519 public key, turns it on,
 * and then AUTH_PASS_AUDIENCE (the application the passes must name) and AUTH_PASS_RESOURCE (the one resource they
 * must name, such as this server's machine) are required. Without the key it is off (null) and the application
 * signs in only as before.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @returns {Readonly<{ publicKey: import("node:crypto").KeyObject, audience: string, resource: string }> | null}
 */
function resolvePassSignInFromEnv(env) {
  const publicKeyText = String(env.AUTH_PASS_PUBLIC_KEY || "").trim();
  if (!publicKeyText) {
    return null;
  }
  const audience = String(env.AUTH_PASS_AUDIENCE || "").trim();
  const resource = String(env.AUTH_PASS_RESOURCE || "").trim();
  if (!audience || !resource) {
    throw new Error("AUTH_PASS_AUDIENCE and AUTH_PASS_RESOURCE are required when AUTH_PASS_PUBLIC_KEY is set.");
  }
  return Object.freeze({
    publicKey: readPassPublicKey(publicKeyText),
    audience,
    resource
  });
}

/**
 * Signs a pass for one person, one application and one resource, valid for `lifetimeSeconds` from `now`, with a new
 * random id unless one is given. For the issuer's server, which keeps the private key; the browser then POSTs the pass
 * to the application's pass sign-in route.
 * @param {object} input
 * @param {import("node:crypto").KeyObject | string} input.privateKey The issuer's Ed25519 private key (a KeyObject or PEM).
 * @param {string} input.subject Who the pass signs in, as the issuer names them; the application maps it to its account.
 * @param {string} input.audience
 * @param {string} input.resource
 * @param {string} [input.id]
 * @param {number} [input.lifetimeSeconds]
 * @param {number} [input.now] Milliseconds since the epoch.
 */
function signPass({
  privateKey,
  subject,
  audience,
  resource,
  id = randomBytes(18).toString("base64url"),
  lifetimeSeconds = PASS_LIFETIME_SECONDS,
  now = Date.now()
}) {
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > PASS_MAX_LIFETIME_SECONDS) {
    throw new Error(`A pass lasts from 1 to ${PASS_MAX_LIFETIME_SECONDS} seconds.`);
  }
  for (const [name, value] of Object.entries({ subject, audience, resource, id })) {
    if (!isClaimText(value)) {
      throw new Error(`A pass's ${name} is text of 1 to ${PASS_MAX_TEXT_CLAIM_LENGTH} characters.`);
    }
  }
  const issuedAt = Math.floor(now / 1000);
  const body = `${base64urlJson({ alg: PASS_ALGORITHM, typ: PASS_TYPE })}.${base64urlJson({
    jti: id,
    sub: subject,
    aud: audience,
    resource,
    iat: issuedAt,
    exp: issuedAt + lifetimeSeconds
  })}`;
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`;
}

/**
 * A verified pass: its id, who it signs in, what it is for, when it was issued and expires (seconds since the epoch),
 * and the moment from which verifyPass refuses it as expired (`usableUntil`, ISO), until which the application must
 * remember it was used.
 * @typedef {Readonly<{
 *   id: string,
 *   subject: string,
 *   audience: string,
 *   resource: string,
 *   issuedAt: number,
 *   expiresAt: number,
 *   usableUntil: string
 * }>} AuthPass
 */

/**
 * Checks a pass against the issuer's public key, the application's audience and resource, and the clock, and answers
 * it; anything else is refused with a 401 naming the reason: `auth.pass.malformed` (not a pass, not yet valid, or
 * longer-lived than five minutes), `auth.pass.badSignature`, `auth.pass.wrongAudience`, `auth.pass.wrongResource` or
 * `auth.pass.expired`. Its claims are read only after its signature checks. Single use is the caller's: it records
 * the pass's id until `usableUntil`.
 * @param {unknown} token
 * @param {object} settings What resolvePassSignInFromEnv answers.
 * @param {import("node:crypto").KeyObject} settings.publicKey
 * @param {string} settings.audience
 * @param {string} settings.resource
 * @param {number} [now] Milliseconds since the epoch.
 * @returns {AuthPass}
 */
function verifyPass(token, { publicKey, audience, resource }, now = Date.now()) {
  const parts = typeof token === "string" && token.length <= PASS_MAX_LENGTH ? token.split(".") : [];
  const header = parts.length === 3 ? parseBase64urlJson(parts[0]) : null;
  if (header?.alg !== PASS_ALGORITHM || header.typ !== PASS_TYPE) {
    throw createPassError(PASS_TEXTS.passMalformed);
  }
  if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url"))) {
    throw createPassError(PASS_TEXTS.passBadSignature);
  }
  const claims = parseBase64urlJson(parts[1]);
  if (!claims || ![claims.jti, claims.sub, claims.aud, claims.resource].every(isClaimText) ||
    !isClaimSeconds(claims.iat) || !isClaimSeconds(claims.exp)) {
    throw createPassError(PASS_TEXTS.passMalformed);
  }
  if (claims.aud !== audience) {
    throw createPassError(PASS_TEXTS.passWrongAudience);
  }
  if (claims.resource !== resource) {
    throw createPassError(PASS_TEXTS.passWrongResource);
  }
  const nowSeconds = Math.floor(now / 1000);
  if (claims.exp + PASS_CLOCK_SKEW_SECONDS <= nowSeconds) {
    throw createPassError(PASS_TEXTS.passExpired);
  }
  const lifetime = claims.exp - claims.iat;
  if (claims.iat - PASS_CLOCK_SKEW_SECONDS > nowSeconds || lifetime < 1 || lifetime > PASS_MAX_LIFETIME_SECONDS) {
    throw createPassError(PASS_TEXTS.passMalformed);
  }
  return Object.freeze({
    id: claims.jti,
    subject: claims.sub,
    audience: claims.aud,
    resource: claims.resource,
    issuedAt: claims.iat,
    expiresAt: claims.exp,
    usableUntil: new Date((claims.exp + PASS_CLOCK_SKEW_SECONDS) * 1000).toISOString()
  });
}

export { resolvePassSignInFromEnv, signPass, verifyPass };
