import { pageLocation, pageWindow } from "../../browser.js";

// The query parameter of the link a registration's confirmation email carries.
const CONFIRMATION_TOKEN_PARAM = "confirmation_token";

/**
 * The code in a pasted confirmation link, or the pasted text itself when it is
 * the bare code.
 * @param {unknown} input
 */
function confirmationTokenFromInput(input) {
  const text = String(input || "").trim();
  try {
    return String(new URL(text).searchParams.get(CONFIRMATION_TOKEN_PARAM) || "").trim() || text;
  } catch {
    return text;
  }
}

/**
 * Takes the confirmation code out of the page's address, so reloading the page
 * or sharing its address does not send it again; "" when there is none.
 */
function takeConfirmationTokenFromLocation() {
  const location = pageLocation();
  if (!location) {
    return "";
  }
  const url = new URL(location.href);
  const token = String(url.searchParams.get(CONFIRMATION_TOKEN_PARAM) || "").trim();
  if (token) {
    url.searchParams.delete(CONFIRMATION_TOKEN_PARAM);
    pageWindow()?.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return token;
}

export { CONFIRMATION_TOKEN_PARAM, confirmationTokenFromInput, takeConfirmationTokenFromLocation };
