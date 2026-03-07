const WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN = "runtime.web-placement.client";
const WEB_PLACEMENT_CONTEXT_CONTRIBUTOR_TAG = "web-placement.context.client";
const WEB_PLACEMENT_RUNTIME_INJECTION_KEY = Symbol.for("jskit.shell-web.runtime.web-placement.client");

const WEB_PLACEMENT_SURFACE_ANY = "*";
const DEFAULT_WEB_PLACEMENT_ORDER = 1000;

const WEB_PLACEMENT_REGIONS = Object.freeze([
  "top",
  "top-left",
  "left",
  "bottom-left",
  "bottom",
  "bottom-right",
  "right",
  "top-right",
  "center",
  "primary-menu",
  "secondary-menu"
]);

export {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  WEB_PLACEMENT_CONTEXT_CONTRIBUTOR_TAG,
  WEB_PLACEMENT_RUNTIME_INJECTION_KEY,
  WEB_PLACEMENT_SURFACE_ANY,
  DEFAULT_WEB_PLACEMENT_ORDER,
  WEB_PLACEMENT_REGIONS
};
