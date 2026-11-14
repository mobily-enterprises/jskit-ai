import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { authHttpRequest } from "./authHttpClient.js";

/**
 * The token of an email change link from a page's address: "" when it has none.
 * @param {string} href
 */
function readEmailChangeToken(href) {
  try {
    return new URL(href).searchParams.get("token") || "";
  } catch {
    return "";
  }
}

/**
 * Confirms the email change a page's link names: `done` with the account's new email, `error` with the refusal, or
 * `missing` when the address has no link, without asking the server.
 * @param {string} href The page's address.
 * @param {typeof authHttpRequest} [request]
 * @returns {Promise<{ status: "done" | "error" | "missing", email: string, error: unknown }>}
 */
async function confirmEmailChangeLink(href, request = authHttpRequest) {
  const token = readEmailChangeToken(href);
  if (!token) {
    return { status: "missing", email: "", error: null };
  }
  try {
    const answer = await request(AUTH_PATHS.EMAIL_CHANGE_CONFIRM, { method: "POST", body: { token } });
    return { status: "done", email: String(answer?.email || ""), error: null };
  } catch (error) {
    return { status: "error", email: "", error };
  }
}

export { confirmEmailChangeLink, readEmailChangeToken };
