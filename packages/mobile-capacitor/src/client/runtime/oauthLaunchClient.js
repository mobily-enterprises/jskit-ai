import { Browser } from "@capacitor/browser";
import { resolveCapacitorAbsoluteHttpUrl } from "./apiRequestClient.js";
import { createTextError } from "../i18n.js";

function resolveCapacitorLaunchUrl(url = "", apiBaseUrl = "") {
  return resolveCapacitorAbsoluteHttpUrl(url, apiBaseUrl, {
    emptyUrlMessage: "jskit.mobile.oauth.urlRequired",
    missingApiBaseUrlMessage: "jskit.mobile.oauth.apiBaseUrlRequired",
    invalidUrlProtocolMessage: "jskit.mobile.oauth.urlProtocol"
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
        throw createTextError("jskit.mobile.oauth.urlRequired");
      }

      if (adapter?.available === true && browserPlugin && typeof browserPlugin.open === "function") {
        await browserPlugin.open({
          url: resolveCapacitorLaunchUrl(normalizedUrl, apiBaseUrl)
        });
        return true;
      }

      if (!resolvedLocation || typeof resolvedLocation.assign !== "function") {
        throw createTextError("jskit.mobile.oauth.browserUnavailable");
      }

      resolvedLocation.assign(normalizedUrl);
      return true;
    }
  });
}

export { createCapacitorAwareOAuthLaunchClient, resolveCapacitorLaunchUrl };
