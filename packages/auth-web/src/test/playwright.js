import { DEV_AUTH_SECRET_HEADER } from "@jskit-ai/auth-core/server/devAuth";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:4173";

function resolveLocalBaseUrl(value) {
  const baseUrl = String(value || DEFAULT_LOCAL_BASE_URL).trim().replace(/\/+$/u, "");
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("loginAsExistingUser requires a valid local baseURL.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const isLocal = hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.") ||
    hostname === "::1";
  if (!isLocal) {
    throw new Error("loginAsExistingUser only sends the dev-auth secret to a local app URL.");
  }

  return baseUrl;
}

function resolveIdentity({ email = "", userId = "" } = {}) {
  const normalizedEmail = String(email || "").trim();
  const normalizedUserId = String(userId || "").trim();
  if (Boolean(normalizedEmail) === Boolean(normalizedUserId)) {
    throw new Error("loginAsExistingUser requires exactly one of email or userId.");
  }
  return normalizedEmail ? { email: normalizedEmail } : { userId: normalizedUserId };
}

async function responseBody(response) {
  const body = await response.text();
  return body ? ` ${body}` : "";
}

async function loginAsExistingUser(page, {
  email = "",
  userId = "",
  secret = process.env.AUTH_DEV_BYPASS_SECRET,
  baseURL = process.env.PLAYWRIGHT_BASE_URL || DEFAULT_LOCAL_BASE_URL
} = {}) {
  const context = page?.context?.();
  if (!context?.request) {
    throw new Error("loginAsExistingUser requires a Playwright page.");
  }

  const normalizedSecret = String(secret || "").trim();
  if (!normalizedSecret) {
    throw new Error("loginAsExistingUser requires AUTH_DEV_BYPASS_SECRET.");
  }

  const localBaseUrl = resolveLocalBaseUrl(baseURL);
  const identity = resolveIdentity({ email, userId });
  const sessionResponse = await context.request.get(`${localBaseUrl}${AUTH_PATHS.SESSION}`);
  if (!sessionResponse.ok()) {
    throw new Error(`Session bootstrap failed: ${sessionResponse.status()}${await responseBody(sessionResponse)}`);
  }

  const session = await sessionResponse.json();
  const csrfToken = String(session?.csrfToken || "").trim();
  if (!csrfToken) {
    throw new Error("Session bootstrap did not return csrfToken.");
  }

  const loginResponse = await context.request.post(`${localBaseUrl}${AUTH_PATHS.DEV_LOGIN_AS}`, {
    data: identity,
    headers: {
      "csrf-token": csrfToken,
      [DEV_AUTH_SECRET_HEADER]: normalizedSecret
    }
  });
  if (!loginResponse.ok()) {
    throw new Error(`Dev login failed: ${loginResponse.status()}${await responseBody(loginResponse)}`);
  }

  return loginResponse.json();
}

export { loginAsExistingUser };
