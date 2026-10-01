import { readFileSync, statSync } from "node:fs";
import { VOICE_ACCESS_TOKEN_VERSION, voiceTenant } from "./voiceAccessToken.js";

function voiceEndpoint(value = "") {
  const endpoint = String(value || "").trim();
  if (!endpoint) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Voice endpoint must be a valid ws:// or wss:// URL.");
  }
  if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Voice endpoint must use ws:// or wss:// without embedded credentials or fragments.");
  }
  return parsed.toString();
}

function readVoiceAccessToken(filePath = "") {
  const pathname = String(filePath || "").trim();
  if (!pathname) {
    return "";
  }
  const metadata = statSync(pathname);
  if (!metadata.isFile() || metadata.size < 16 || metadata.size > 4_096) {
    throw new Error("The voice credential file is invalid.");
  }
  const token = readFileSync(pathname, "utf8").trim();
  let valid;
  try {
    const [version, tenant = "", signature = "", ...extra] = token.split(".");
    valid = version === VOICE_ACCESS_TOKEN_VERSION &&
      extra.length === 0 &&
      voiceTenant(tenant) === tenant &&
      /^[A-Za-z0-9_-]{43}$/u.test(signature) &&
      Buffer.from(signature, "base64url").toString("base64url") === signature;
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new Error("The voice credential is malformed.");
  }
  return token;
}

function resolveVoiceProxyConfig({ endpoint: value = "", accessTokenFile = "" } = {}) {
  const endpoint = voiceEndpoint(value);
  const tokenFile = String(accessTokenFile || "").trim();
  if (!endpoint && !tokenFile) {
    return Object.freeze({ available: false, endpoint: "", token: "" });
  }
  if (!endpoint || !tokenFile) {
    throw new Error(
      "Voice endpoint and accessTokenFile must be configured together."
    );
  }
  return Object.freeze({
    available: true,
    endpoint,
    token: readVoiceAccessToken(tokenFile)
  });
}

export {
  readVoiceAccessToken,
  resolveVoiceProxyConfig,
  voiceEndpoint
};
