import { readFileSync, statSync } from "node:fs";
import { isVoiceClientToken } from "./voiceCredentials.js";

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

function voiceClientToken(value = "") {
  const token = String(value || "").trim();
  if (!isVoiceClientToken(token)) {
    throw new Error("The voice credential is malformed: a token is 32 to 1024 base64url, base64 or hex characters.");
  }
  return token;
}

function readVoiceAccessToken(filePath = "") {
  const pathname = String(filePath || "").trim();
  if (!pathname) {
    return "";
  }
  const metadata = statSync(pathname);
  if (!metadata.isFile() || metadata.size < 32 || metadata.size > 4_096) {
    throw new Error("The voice credential file is invalid.");
  }
  return voiceClientToken(readFileSync(pathname, "utf8"));
}

/**
 * A voice client's connection to its speech service: the service's /v1/voice
 * address and the client's token, given as its value or a protected file.
 * @param {{ endpoint?: string, accessToken?: string, accessTokenFile?: string }} [options]
 */
function resolveVoiceProxyConfig({ endpoint: value = "", accessToken = "", accessTokenFile = "" } = {}) {
  const endpoint = voiceEndpoint(value);
  const tokenValue = String(accessToken || "").trim();
  const tokenFile = String(accessTokenFile || "").trim();
  if (!endpoint && !tokenValue && !tokenFile) {
    return Object.freeze({
      available: false,
      endpoint: "",
      token: ""
    });
  }
  if (tokenValue && tokenFile) {
    throw new Error("Give the voice service accessToken or accessTokenFile, not both.");
  }
  if (!endpoint || (!tokenValue && !tokenFile)) {
    throw new Error(
      "Voice endpoint and its accessToken or accessTokenFile must be configured together."
    );
  }
  return Object.freeze({
    available: true,
    endpoint,
    token: tokenValue ? voiceClientToken(tokenValue) : readVoiceAccessToken(tokenFile)
  });
}

export {
  readVoiceAccessToken,
  resolveVoiceProxyConfig,
  voiceEndpoint
};
