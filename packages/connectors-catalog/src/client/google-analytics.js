// Optional browser implementation. The application owns consent and route hooks.
const installations = new WeakMap();

function createGoogleAnalytics({ measurementId, window: browser = globalThis.window } = {}) {
  if (typeof measurementId !== "string" || !/^G-[A-Z0-9]+$/.test(measurementId) || measurementId.length > 64) throw new TypeError("Supply a valid GA4 Measurement ID.");
  if (!browser?.document) throw new TypeError("Initialize Google Analytics in the browser after hydration.");
  const existing = installations.get(browser);
  if (existing) {
    if (existing.measurementId !== measurementId) throw new Error("This page already has an Analytics owner. Reload to change the Measurement ID.");
    return existing.controller;
  }
  if (browser.gtag || browser.document.querySelector('script[src*="googletagmanager.com/"]')) throw new Error("Use the application's existing Google tag or Tag Manager instead of installing a second tracker.");
  if (browser.dataLayer !== undefined && !Array.isArray(browser.dataLayer)) throw new TypeError("The existing dataLayer must be an array.");
  let enabled = false, initialized = false, disposed = false, script, lastPage;
  const disabledKey = `ga-disable-${measurementId}`;
  browser[disabledKey] = true;
  function active() { if (disposed) throw new Error("Analytics has been disposed. Reload before configuring tracking again."); }
  function queue(...args) { browser.gtag(...args); }
  const controller = Object.freeze({
    setConsent(granted) {
      active();
      if (typeof granted !== "boolean") throw new TypeError("Pass an explicit consent boolean.");
      enabled = granted;
      browser[disabledKey] = !granted;
      if (!granted) { lastPage = undefined; return; }
      if (initialized) return;
      // Check again: another integration may have installed a tag since creation.
      if (browser.gtag || browser.document.querySelector('script[src*="googletagmanager.com/"]')) {
        enabled = false; browser[disabledKey] = true;
        throw new Error("Use the application's existing Google tracking installation.");
      }
      browser.dataLayer ||= [];
      browser.gtag = function () { browser.dataLayer.push(arguments); };
      queue("js", new Date());
      queue("config", measurementId, { send_page_view: false });
      script = browser.document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      browser.document.head.appendChild(script);
      initialized = true;
    },
    pageView({ location = browser.location.href, title = browser.document.title } = {}) {
      active();
      if (!enabled) return false;
      const url = new URL(location);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new TypeError("Supply a public HTTP(S) page URL without credentials.");
      if (typeof title !== "string") throw new TypeError("Supply a page title.");
      if (lastPage === url.href) return false;
      const previous = lastPage;
      lastPage = url.href;
      queue("event", "page_view", { send_to: measurementId, page_location: url.href, page_title: title, ...(previous ? { page_referrer: previous } : {}) });
      return true;
    },
    event(name, parameters = {}) {
      active();
      if (!enabled) return false;
      if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) || /^(?:google_|ga_|firebase_)/.test(name) || name === "page_view") throw new TypeError("Use a valid event name; page views use pageView.");
      if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new TypeError("Supply an event parameter object.");
      queue("event", name, { ...parameters, send_to: measurementId });
      return true;
    },
    dispose() {
      enabled = false; disposed = true; browser[disabledKey] = true;
      script?.remove();
      // Loaded Google code cannot be unloaded. Keep ownership until page reload.
    }
  });
  installations.set(browser, { measurementId, controller });
  return controller;
}

export { createGoogleAnalytics };
