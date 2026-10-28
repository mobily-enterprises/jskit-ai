import { createBrowserOAuthLaunchClient } from "./oauthLaunchClient.js";
import { useJskitText } from "../i18n.js";

// A sign-in page refuses to be framed, so a framed app (an editor Preview, an
// embedded dashboard) signs in through a window of its own. The window
// completes the callback on the app's origin, tells the framed page, and closes.
const OAUTH_POPUP_WINDOW_NAME = "jskit-oauth-sign-in";
const OAUTH_POPUP_MESSAGE_TYPE = "jskit.auth-web.oauth-popup.complete";
const OAUTH_POPUP_MARKER_KEY = "jskit.auth-web.oauth-popup.started-at";
const OAUTH_POPUP_LIFETIME_MS = 10 * 60 * 1000;
// The English of jskit.auth.oauth.popupBlocked; the error itself is in the user's language.
const OAUTH_POPUP_BLOCKED_MESSAGE =
  "Your browser blocked the sign-in window. Allow pop-ups for this page, then try again.";

function browserWindow() {
  return typeof window === "object" && window ? window : null;
}

function isFramedWindow(win) {
  try {
    return win.self !== win.top;
  } catch {
    // A cross-origin parent hides window.top: that is a frame too.
    return true;
  }
}

function storageOf(win) {
  try {
    return win.localStorage || null;
  } catch {
    return null;
  }
}

function popupFeatures(win, width = 520, height = 680) {
  const left = Math.max(0, Math.round((win.screenX || 0) + ((win.outerWidth || width) - width) / 2));
  const top = Math.max(0, Math.round((win.screenY || 0) + ((win.outerHeight || height) - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

function openChannel(win) {
  return typeof win.BroadcastChannel === "function" ? new win.BroadcastChannel(OAUTH_POPUP_MESSAGE_TYPE) : null;
}

function createPopupOAuthLaunchClient({
  window: win = browserWindow(),
  fallback = createBrowserOAuthLaunchClient(),
  onComplete = null
} = {}) {
  return Object.freeze({
    async open({ url = "" } = {}) {
      if (!win || !isFramedWindow(win)) {
        return fallback.open({ url });
      }
      const normalizedUrl = String(url || "").trim();
      if (!normalizedUrl) {
        throw new Error("OAuth launch URL is required.");
      }
      const popup = win.open(normalizedUrl, OAUTH_POPUP_WINDOW_NAME, popupFeatures(win));
      if (!popup) {
        throw new Error(useJskitText().t("jskit.auth.oauth.popupBlocked"));
      }
      storageOf(win)?.setItem(OAUTH_POPUP_MARKER_KEY, String(Date.now()));
      popup.focus?.();

      // Some sign-in pages cut the opener link, so the window also answers on
      // a same-origin channel. Closing it without finishing leaves this page as it was.
      return new Promise((resolve) => {
        const channel = openChannel(win);
        let timer = null;
        const finish = (completed) => {
          win.removeEventListener("message", onMessage);
          channel?.close();
          win.clearTimeout(timer);
          resolve(completed);
          if (!completed) {
            return;
          }
          if (typeof onComplete === "function") {
            onComplete();
          } else {
            win.location.reload();
          }
        };
        const onMessage = (event) => {
          if (event?.origin === win.location.origin && event?.data?.type === OAUTH_POPUP_MESSAGE_TYPE) {
            finish(true);
          }
        };
        win.addEventListener("message", onMessage);
        if (channel) {
          channel.onmessage = (event) => {
            if (event?.data?.type === OAUTH_POPUP_MESSAGE_TYPE) {
              finish(true);
            }
          };
        }
        timer = win.setTimeout(() => finish(false), OAUTH_POPUP_LIFETIME_MS);
      });
    }
  });
}

function sameOriginOpener(win) {
  try {
    const opener = win.opener;
    return opener && opener !== win && !opener.closed && opener.location.origin === win.location.origin ? opener : null;
  } catch {
    return null;
  }
}

/**
 * Called by the callback page after a completed sign-in. When this page is the
 * sign-in window opened by a framed app, it tells that app and closes, and the
 * function returns true. Otherwise it does nothing and returns false.
 */
function completeOAuthPopupSignIn(win = browserWindow()) {
  if (!win) {
    return false;
  }
  const storage = storageOf(win);
  const startedAt = Number(storage?.getItem(OAUTH_POPUP_MARKER_KEY) || 0);
  const opener = sameOriginOpener(win);
  const recentlyStarted = startedAt > 0 && Date.now() - startedAt < OAUTH_POPUP_LIFETIME_MS;
  if (!opener && !recentlyStarted) {
    return false;
  }
  storage?.removeItem(OAUTH_POPUP_MARKER_KEY);
  const message = { type: OAUTH_POPUP_MESSAGE_TYPE };
  opener?.postMessage(message, win.location.origin);
  const channel = openChannel(win);
  channel?.postMessage(message);
  channel?.close();
  win.close();
  return true;
}

export {
  OAUTH_POPUP_BLOCKED_MESSAGE,
  OAUTH_POPUP_MESSAGE_TYPE,
  completeOAuthPopupSignIn,
  createPopupOAuthLaunchClient,
  isFramedWindow
};
