import { pageWindow } from "../../browser.js";

// The provider sign-in this tab started, kept for the page the provider sends it back to: a provider with one fixed
// redirect address (the local provider's /auth/login) returns no returnTo or invitation, and a cancelled or failed
// sign-in is not told the server's. Session storage keeps it to this tab; it holds no secret, only where to go.
const OAUTH_START_KEY = "jskit.auth-web.oauth-start";

// Storage the browser refuses (blocked site data, a private window) throws on access: the sign-in then works as
// before, without the way back.
function tabStorage() {
  try {
    return pageWindow()?.sessionStorage || null;
  } catch {
    return null;
  }
}

/**
 * @param {{ provider: string, returnTo: string, invitationToken?: string }} start
 */
function rememberOAuthStart({ provider, returnTo, invitationToken = "" }) {
  try {
    tabStorage()?.setItem(OAUTH_START_KEY, JSON.stringify({ provider, returnTo, invitationToken }));
  } catch {
    // Nothing kept: see tabStorage.
  }
}

/**
 * The sign-in this tab started, or null.
 * @returns {{ provider: string, returnTo: string, invitationToken: string } | null}
 */
function readOAuthStart() {
  try {
    const stored = JSON.parse(tabStorage()?.getItem(OAUTH_START_KEY) || "null");
    if (!stored || typeof stored !== "object" || typeof stored.provider !== "string" || !stored.provider) {
      return null;
    }
    return {
      provider: stored.provider,
      returnTo: typeof stored.returnTo === "string" ? stored.returnTo : "",
      invitationToken: typeof stored.invitationToken === "string" ? stored.invitationToken : ""
    };
  } catch {
    return null;
  }
}

function forgetOAuthStart() {
  try {
    tabStorage()?.removeItem(OAUTH_START_KEY);
  } catch {
    // Nothing to forget.
  }
}

export { OAUTH_START_KEY, forgetOAuthStart, readOAuthStart, rememberOAuthStart };
