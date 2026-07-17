import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { timingSafeEqual } from "node:crypto";
import { parseBooleanFlag } from "./booleanFlag.js";

const DEV_AUTH_SECRET_HEADER = "x-jskit-dev-auth-secret";

function normalizeRequestHostname(request) {
  const hostHeader = String(request?.headers?.host || "").trim();
  const firstHost = hostHeader.split(",")[0]?.trim();
  if (!firstHost) {
    return "";
  }
  try {
    return new URL(`http://${firstHost}`).hostname.trim().toLowerCase();
  } catch {
    return firstHost
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(":")[0]
      .trim()
      .toLowerCase();
  }
}

function normalizeLoopbackIp(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/^::ffff:/u, "");
}

function isLoopbackIp(value) {
  const normalized = normalizeLoopbackIp(value);
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

function isLoopbackHostname(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "");
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "127.0.0.1";
}

function isLocalDevAuthRequest(request) {
  const remoteAddress = String(
    request?.socket?.remoteAddress || request?.raw?.socket?.remoteAddress || ""
  ).trim();
  return isLoopbackIp(remoteAddress) && isLoopbackHostname(normalizeRequestHostname(request));
}

function resolveDevAuthPolicy({
  enabled = false,
  nodeEnv = "development",
  secret = ""
} = {}) {
  return Object.freeze({
    enabled: parseBooleanFlag(enabled, false),
    isProduction: String(nodeEnv || "development").trim().toLowerCase() === "production",
    secret: String(secret || "").trim()
  });
}

function resolveDevAuthPolicyFromEnv(env = {}) {
  return resolveDevAuthPolicy({
    enabled: env?.AUTH_DEV_BYPASS_ENABLED,
    nodeEnv: env?.NODE_ENV,
    secret: env?.AUTH_DEV_BYPASS_SECRET
  });
}

function assertDevAuthPolicy(policy = {}) {
  if (!policy.enabled) {
    return;
  }
  if (policy.isProduction) {
    throw new Error("AUTH_DEV_BYPASS_ENABLED must not be enabled in production.");
  }
  if (!policy.secret) {
    throw new Error("AUTH_DEV_BYPASS_SECRET is required when AUTH_DEV_BYPASS_ENABLED=true.");
  }
}

function ensureDevAuthRuntimeAvailable(policy = {}, request = null) {
  if (!policy.enabled || policy.isProduction) {
    throw new AppError(404, "Not found.");
  }
  if (!policy.secret) {
    throw new AppError(500, "AUTH_DEV_BYPASS_SECRET is required when AUTH_DEV_BYPASS_ENABLED=true.");
  }
  if (!isLocalDevAuthRequest(request)) {
    throw new AppError(403, "Dev auth bootstrap is only available from localhost.");
  }
}

function requestHeader(request, name = "") {
  const headers = request?.headers || request?.raw?.headers || {};
  const value = headers[String(name || "").toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? value[0] : String(value || "");
}

function secretMatches(value = "", expected = "") {
  const actualBuffer = Buffer.from(String(value || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function ensureDevAuthExchangeAvailable(policy = {}, request = null) {
  ensureDevAuthRuntimeAvailable(policy, request);
  if (!secretMatches(requestHeader(request, DEV_AUTH_SECRET_HEADER), policy.secret)) {
    throw new AppError(403, "Dev auth exchange is not authorized.");
  }
}

export {
  assertDevAuthPolicy,
  DEV_AUTH_SECRET_HEADER,
  ensureDevAuthExchangeAvailable,
  ensureDevAuthRuntimeAvailable,
  isLocalDevAuthRequest,
  resolveDevAuthPolicy,
  resolveDevAuthPolicyFromEnv
};
