import { pageLocation } from "../browser.js";

/** @param {{ location?: Pick<Location, "assign"> | null }} [options] */
function createBrowserOAuthLaunchClient({ location = pageLocation() } = {}) {
  async function open({ url = "" } = {}) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      throw new Error("OAuth launch URL is required.");
    }
    if (!location) {
      throw new Error("Browser location.assign() is unavailable for OAuth launch.");
    }

    location.assign(normalizedUrl);
    return true;
  }

  return Object.freeze({
    open
  });
}

export { createBrowserOAuthLaunchClient };
