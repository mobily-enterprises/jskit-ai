import { Browser } from "@capacitor/browser";
import { resolveCapacitorAbsoluteHttpUrl } from "./apiRequestClient.js";

function resolveCapacitorLaunchUrl(url = "", apiBaseUrl = "") {
  return resolveCapacitorAbsoluteHttpUrl(url, apiBaseUrl, {
    emptyUrlMessage: "OAuth launch URL is required.",
    missingApiBaseUrlMessage: "config.mobile.apiBaseUrl is required to launch OAuth from the Capacitor shell.",
    invalidUrlProtocolMessage: "OAuth launch URL must use http or https."
  });
}

function createCapacitorAwareOAuthLaunchClient({
  adapter = null,
  browserPlugin = Browser,
  location = null,
  apiBaseUrl = ""
} = {}) {
  const resolvedLocation =
    location || (typeof window === "object" && window?.location ? window.location : null);

  return Object.freeze({
    async open({ url = "" } = {}) {
      const normalizedUrl = String(url || "").trim();
      if (!normalizedUrl) {
        throw new Error("OAuth launch URL is required.");
      }

      if (adapter?.available === true && browserPlugin && typeof browserPlugin.open === "function") {
        await browserPlugin.open({
          url: resolveCapacitorLaunchUrl(normalizedUrl, apiBaseUrl)
        });
        return true;
      }

      if (!resolvedLocation || typeof resolvedLocation.assign !== "function") {
        throw new Error("Browser location.assign() is unavailable for OAuth launch.");
      }

      resolvedLocation.assign(normalizedUrl);
      return true;
    }
  });
}

export { createCapacitorAwareOAuthLaunchClient, resolveCapacitorLaunchUrl };
