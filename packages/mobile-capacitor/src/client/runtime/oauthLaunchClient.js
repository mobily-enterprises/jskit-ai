import { Browser } from "@capacitor/browser";
import { resolveCapacitorAbsoluteHttpUrl } from "./apiRequestClient.js";
import { pageLocation } from "../browser.js";
import { createTextError } from "../i18n.js";

function resolveCapacitorLaunchUrl(url = "", apiBaseUrl = "") {
  return resolveCapacitorAbsoluteHttpUrl(url, apiBaseUrl, {
    emptyUrlMessage: "jskit.mobile.oauth.urlRequired",
    missingApiBaseUrlMessage: "jskit.mobile.oauth.apiBaseUrlRequired",
    invalidUrlProtocolMessage: "jskit.mobile.oauth.urlProtocol"
  });
}

/**
 * @param {object} options
 * @param {import("../types.js").CapacitorAppAdapter} options.adapter
 * @param {{ open: (options: { url: string }) => Promise<void> }} [options.browserPlugin]
 * @param {Pick<import("../types.js").PageLocation, "assign">} [options.location]
 * @param {string} [options.apiBaseUrl]
 */
function createCapacitorAwareOAuthLaunchClient({
  adapter,
  browserPlugin = Browser,
  location = pageLocation(),
  apiBaseUrl = ""
}) {
  async function open({ url = "" } = {}) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      throw createTextError("jskit.mobile.oauth.urlRequired");
    }

    if (adapter.available === true) {
      await browserPlugin.open({
        url: resolveCapacitorLaunchUrl(normalizedUrl, apiBaseUrl)
      });
      return true;
    }

    location.assign(normalizedUrl);
    return true;
  }

  return Object.freeze({
    open
  });
}

export { createCapacitorAwareOAuthLaunchClient, resolveCapacitorLaunchUrl };
