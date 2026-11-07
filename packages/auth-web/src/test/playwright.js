import { DEV_AUTH_SECRET_HEADER } from "@jskit-ai/auth-core/server/devAuth";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

function resolveLocalBaseUrl(value) {
  const baseUrl = String(value).trim().replace(/\/+$/u, "");
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

/**
 * Signs `page`'s context in as an existing user through the local app's dev-auth route. Without `baseURL`, it signs in
 * on the test's own baseURL, its context's: under browserTestConfig() each worker's own server. The private secret is
 * only ever sent to a local app URL; a managed target (PLAYWRIGHT_BASE_URL) is refused before any request.
 * @param {import("@playwright/test").Page} page
 * @param {{ email?: string, userId?: string, secret?: string, baseURL?: string }} [options]
 */
async function loginAsExistingUser(page, {
  email = "",
  userId = "",
  secret = process.env.AUTH_DEV_BYPASS_SECRET,
  baseURL = ""
} = {}) {
  const context = page?.context?.();
  if (!context?.request) {
    throw new Error("loginAsExistingUser requires a Playwright page.");
  }

  const normalizedSecret = String(secret || "").trim();
  if (!normalizedSecret) {
    throw new Error("loginAsExistingUser requires AUTH_DEV_BYPASS_SECRET.");
  }

  const givenBaseUrl = baseURL ? resolveLocalBaseUrl(baseURL) : "";
  if (!givenBaseUrl && process.env.PLAYWRIGHT_BASE_URL) {
    resolveLocalBaseUrl(process.env.PLAYWRIGHT_BASE_URL);
  }
  const identity = resolveIdentity({ email, userId });
  // A path alone resolves against the context's own baseURL.
  const sessionResponse = await context.request.get(`${givenBaseUrl}${AUTH_PATHS.SESSION}`);
  if (!sessionResponse.ok()) {
    throw new Error(`Session bootstrap failed: ${sessionResponse.status()}${await responseBody(sessionResponse)}`);
  }
  // The secret goes only to the local server that answered the session request.
  const localBaseUrl = givenBaseUrl || resolveLocalBaseUrl(new URL(sessionResponse.url()).origin);

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
