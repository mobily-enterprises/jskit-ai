import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { resolvePassSignInFromEnv, signPass, verifyPass } from "../src/server/passSignIn.js";

const NOW = Date.parse("2026-11-13T10:00:00.000Z");
const issuer = generateKeyPairSync("ed25519");
const settings = Object.freeze({ publicKey: issuer.publicKey, audience: "editor", resource: "machine-7" });
const pass = (overrides = {}) =>
  signPass({ privateKey: issuer.privateKey, subject: "ada", audience: "editor", resource: "machine-7", now: NOW, ...overrides });
const refused = (code, status = 401) => (error) => {
  assert.equal(error.status, status);
  assert.equal(error.code, code);
  assert.ok(error.message.length > 0);
  return true;
};

// A token with any header and claims, signed with the issuer's key, for the claims signPass never writes.
function signedToken(header, claims, privateKey = issuer.privateKey) {
  const body = [header, claims].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".");
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`;
}

test("a pass the issuer signed for this audience and resource is accepted, with what it names", () => {
  const verified = verifyPass(pass({ id: "pass-1" }), settings, NOW + 59_000);
  assert.deepEqual(verified, {
    id: "pass-1",
    subject: "ada",
    audience: "editor",
    resource: "machine-7",
    issuedAt: NOW / 1000,
    expiresAt: NOW / 1000 + 60,
    usableUntil: "2026-11-13T10:01:30.000Z"
  });
  assert.equal(Object.isFrozen(verified), true);
  // A new id for every pass signed without one.
  assert.notEqual(verifyPass(pass(), settings, NOW).id, verifyPass(pass(), settings, NOW).id);
});

test("an expired pass is refused, after the clock skew", () => {
  const token = pass({ lifetimeSeconds: 60 });
  assert.equal(verifyPass(token, settings, NOW + 89_999).subject, "ada");
  assert.throws(() => verifyPass(token, settings, NOW + 90_000), refused("auth.pass.expired"));
});

test("a pass another key signed, or one changed after signing, is refused as wrongly signed", () => {
  const stranger = generateKeyPairSync("ed25519");
  assert.throws(() => verifyPass(pass({ privateKey: stranger.privateKey }), settings, NOW), refused("auth.pass.badSignature"));

  const [header, , signature] = pass().split(".");
  const changed = Buffer.from(JSON.stringify({
    jti: "pass-2", sub: "admin", aud: "editor", resource: "machine-7", iat: NOW / 1000, exp: NOW / 1000 + 60
  })).toString("base64url");
  assert.throws(() => verifyPass(`${header}.${changed}.${signature}`, settings, NOW), refused("auth.pass.badSignature"));
});

test("a pass for another application is refused as for another audience", () => {
  assert.throws(() => verifyPass(pass({ audience: "console" }), settings, NOW), refused("auth.pass.wrongAudience"));
});

test("a pass for another resource is refused as for another resource", () => {
  assert.throws(() => verifyPass(pass({ resource: "machine-8" }), settings, NOW), refused("auth.pass.wrongResource"));
});

test("anything that is not a pass is refused as malformed, its claims read only once its signature checks", () => {
  const claims = { jti: "pass-3", sub: "ada", aud: "editor", resource: "machine-7", iat: NOW / 1000, exp: NOW / 1000 + 60 };
  const header = { alg: "EdDSA", typ: "pass+jwt" };
  for (const token of [
    undefined,
    "",
    "not.a.pass",
    "a.b",
    `${pass()}.extra`,
    "x".repeat(4097),
    // Another algorithm or another kind of token the same key signs.
    signedToken({ alg: "none", typ: "pass+jwt" }, claims),
    signedToken({ alg: "EdDSA", typ: "JWT" }, claims),
    // Claims missing, of the wrong type, or too long.
    signedToken(header, { ...claims, sub: undefined }),
    signedToken(header, { ...claims, jti: 7 }),
    signedToken(header, { ...claims, resource: "r".repeat(256) }),
    signedToken(header, { ...claims, exp: String(claims.exp) }),
    signedToken(header, [claims]),
    // Not yet valid, longer-lived than five minutes, or expiring before it was issued.
    signedToken(header, { ...claims, iat: claims.iat + 31, exp: claims.exp + 31 }),
    signedToken(header, { ...claims, exp: claims.iat + 301 }),
    signedToken(header, { ...claims, exp: claims.iat })
  ]) {
    assert.throws(() => verifyPass(token, settings, NOW), refused("auth.pass.malformed"), String(token).slice(0, 40));
  }
  // Within the clock skew, a pass issued a little in the future is accepted.
  assert.equal(verifyPass(signedToken(header, { ...claims, iat: claims.iat + 30, exp: claims.exp + 30 }), settings, NOW).id, "pass-3");
});

test("signPass refuses what verifyPass would", () => {
  assert.throws(() => pass({ lifetimeSeconds: 301 }), /from 1 to 300 seconds/u);
  assert.throws(() => pass({ lifetimeSeconds: 0 }), /from 1 to 300 seconds/u);
  assert.throws(() => pass({ subject: "" }), /subject is text of 1 to 255 characters/u);
  assert.throws(() => pass({ resource: "r".repeat(256) }), /resource is text/u);
});

test("pass sign-in is off without AUTH_PASS_PUBLIC_KEY, and its settings are checked when it is on", () => {
  assert.equal(resolvePassSignInFromEnv({}), null);
  assert.equal(resolvePassSignInFromEnv({ AUTH_PASS_PUBLIC_KEY: "  ", AUTH_PASS_AUDIENCE: "editor" }), null);

  const pem = issuer.publicKey.export({ type: "spki", format: "pem" });
  const oneLine = issuer.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  for (const key of [pem, oneLine]) {
    const resolved = resolvePassSignInFromEnv({ AUTH_PASS_PUBLIC_KEY: key, AUTH_PASS_AUDIENCE: " editor ", AUTH_PASS_RESOURCE: "machine-7" });
    assert.equal(resolved.audience, "editor");
    assert.equal(resolved.resource, "machine-7");
    assert.equal(verifyPass(pass(), resolved, NOW).subject, "ada");
  }

  assert.throws(() => resolvePassSignInFromEnv({ AUTH_PASS_PUBLIC_KEY: oneLine, AUTH_PASS_AUDIENCE: "editor" }),
    /AUTH_PASS_AUDIENCE and AUTH_PASS_RESOURCE are required/u);
  assert.throws(() => resolvePassSignInFromEnv({ AUTH_PASS_PUBLIC_KEY: "not a key", AUTH_PASS_AUDIENCE: "a", AUTH_PASS_RESOURCE: "r" }),
    /AUTH_PASS_PUBLIC_KEY is not a public key/u);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => resolvePassSignInFromEnv({ AUTH_PASS_PUBLIC_KEY: rsa, AUTH_PASS_AUDIENCE: "a", AUTH_PASS_RESOURCE: "r" }),
    /must be an Ed25519 public key/u);
});
