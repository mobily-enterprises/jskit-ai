import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseBase64urlJson(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function sha256Base64url(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("base64url");
}

function signToken(payload, secret) {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(payload);
  const body = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", String(secret || ""))
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function verifySignedToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    return null;
  }
  const body = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", String(secret || ""))
    .update(body)
    .digest("base64url");
  const actual = parts[2];
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }
  const payload = parseBase64urlJson(parts[1]);
  if (Number(payload.exp || 0) > 0 && Number(payload.exp) <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export { randomToken, sha256Base64url, signToken, verifySignedToken };
