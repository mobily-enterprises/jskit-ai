import { isRecord, normalizeObject } from "../../shared/support/normalize.js";
import { isDeployed } from "../../shared/support/appEnvironment.js";

/** @typedef {import("../types.js").RuntimeConfig} RuntimeConfig */
/** @typedef {import("../types.js").RuntimeEnv} RuntimeEnv */
/** @typedef {import("../types.js").RuntimeFastify} RuntimeFastify */

const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";
const DEFAULT_FRAME_ANCESTORS = Object.freeze(["'self'"]);
const DEFAULT_STRICT_TRANSPORT_SECURITY = "max-age=31536000";
const CONTENT_SECURITY_POLICY_MODES = Object.freeze(["report-only", "enforce", "off"]);

/**
 * The content policy JSKIT's client runs under: its own scripts (and WebAssembly), Vuetify's and
 * the start-up page's inline styles, images from anywhere over HTTPS, and same-origin requests and
 * sockets.
 */
const DEFAULT_CONTENT_SECURITY_POLICY_DIRECTIVES = Object.freeze({
  "default-src": Object.freeze(["'self'"]),
  "script-src": Object.freeze(["'self'", "'wasm-unsafe-eval'"]),
  "style-src": Object.freeze(["'self'", "'unsafe-inline'"]),
  "img-src": Object.freeze(["'self'", "data:", "blob:", "https:"]),
  "font-src": Object.freeze(["'self'", "data:"]),
  "connect-src": Object.freeze(["'self'"]),
  "media-src": Object.freeze(["'self'", "data:", "blob:"]),
  "worker-src": Object.freeze(["'self'", "blob:"]),
  "object-src": Object.freeze(["'none'"]),
  "base-uri": Object.freeze(["'self'"]),
  "form-action": Object.freeze(["'self'"])
});

const DIRECTIVE_NAME_PATTERN = /^[a-z][a-z-]*$/u;
const SOURCE_PATTERN = /^[^\s;,]+$/u;
const HEADER_TEXT_PATTERN = /^[^\r\n]+$/u;

/**
 * A header's text from config: the default when absent, nothing when false.
 * @param {unknown} value
 * @param {string} fallback
 * @param {string} key The config key, for the error.
 */
function resolveHeaderText(value, fallback, key) {
  if (value === undefined) {
    return fallback;
  }
  if (value === false) {
    return "";
  }
  if (typeof value !== "string" || !HEADER_TEXT_PATTERN.test(value.trim())) {
    throw new TypeError(`config.securityHeaders.${key} must be a header value or false.`);
  }
  return value.trim();
}

/**
 * A policy directive's sources, each one checked.
 * @param {unknown} value
 * @param {string} key The config key, for the error.
 */
function resolveSources(value, key) {
  if (!Array.isArray(value) || value.length < 1 || !value.every((source) => typeof source === "string" && SOURCE_PATTERN.test(source))) {
    throw new TypeError(`config.securityHeaders.${key} must be a non-empty list of policy sources, such as "'self'" or "https://editor.example.com".`);
  }
  return Object.freeze([...value]);
}

/**
 * The frame-ancestors sources: who may frame the application's pages in production.
 * @param {unknown} value
 */
function resolveFrameAncestors(value) {
  if (value === undefined) {
    return DEFAULT_FRAME_ANCESTORS;
  }
  if (value === false) {
    return Object.freeze([]);
  }
  return resolveSources(value, "frameAncestors");
}

/**
 * The content policy's directives: JSKIT's defaults with the application's overrides, where false
 * drops a directive.
 * @param {unknown} value
 */
function resolveDirectives(value) {
  if (value !== undefined && !isRecord(value)) {
    throw new TypeError("config.securityHeaders.contentSecurityPolicy.directives must be an object of directive sources.");
  }
  const directives = { ...DEFAULT_CONTENT_SECURITY_POLICY_DIRECTIVES };
  for (const [name, sources] of Object.entries(normalizeObject(value))) {
    if (!DIRECTIVE_NAME_PATTERN.test(name) || name === "frame-ancestors") {
      throw new TypeError(`config.securityHeaders.contentSecurityPolicy.directives cannot set "${name}"; use frameAncestors for framing.`);
    }
    if (sources === false) {
      delete directives[name];
    } else {
      directives[name] = resolveSources(sources, `contentSecurityPolicy.directives["${name}"]`);
    }
  }
  return directives;
}

/**
 * @param {Record<string, readonly string[]>} directives
 */
function toPolicyText(directives) {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * The production Content-Security-Policy headers: frame-ancestors is always enforced (browsers
 * ignore it in a report-only policy), and the content policy is reported, enforced or left out.
 * @param {Record<string, unknown>} settings The application's `securityHeaders` config.
 */
function resolveContentSecurityPolicyHeaders(settings) {
  const frameAncestors = resolveFrameAncestors(settings.frameAncestors);
  const policySettings = normalizeObject(settings.contentSecurityPolicy);
  const mode = policySettings.mode === undefined ? "report-only" : policySettings.mode;
  if (!CONTENT_SECURITY_POLICY_MODES.includes(/** @type {string} */ (mode))) {
    throw new TypeError(`config.securityHeaders.contentSecurityPolicy.mode must be one of: ${CONTENT_SECURITY_POLICY_MODES.join(", ")}.`);
  }
  const directives = resolveDirectives(policySettings.directives);
  const framing = frameAncestors.length > 0 ? { "frame-ancestors": frameAncestors } : {};
  if (mode === "enforce") {
    return [["content-security-policy", toPolicyText({ ...directives, ...framing })]];
  }
  const headers = frameAncestors.length > 0 ? [["content-security-policy", toPolicyText(framing)]] : [];
  if (mode === "report-only") {
    headers.push(["content-security-policy-report-only", toPolicyText(directives)]);
  }
  return headers;
}

/**
 * The security headers every response gets, from the application's `config.securityHeaders`.
 * nosniff and Referrer-Policy are always sent. Staging and production (APP_ENV) add HSTS and the
 * Content-Security-Policy with frame-ancestors; development and test leave them out, so an editor's
 * preview can frame the application and inject its bridge.
 * @param {object} options
 * @param {RuntimeConfig} options.config
 * @param {RuntimeEnv} options.env
 * @returns {ReadonlyArray<readonly [string, string]>}
 */
function resolveSecurityHeaders({ config, env }) {
  if (config.securityHeaders !== undefined && !isRecord(config.securityHeaders)) {
    throw new TypeError("config.securityHeaders must be an object.");
  }
  const settings = normalizeObject(config.securityHeaders);
  const headers = [];
  if (settings.noSniff !== false) {
    headers.push(["x-content-type-options", "nosniff"]);
  }
  const referrerPolicy = resolveHeaderText(settings.referrerPolicy, DEFAULT_REFERRER_POLICY, "referrerPolicy");
  if (referrerPolicy) {
    headers.push(["referrer-policy", referrerPolicy]);
  }
  if (isDeployed(env)) {
    const strictTransportSecurity = resolveHeaderText(
      settings.strictTransportSecurity,
      DEFAULT_STRICT_TRANSPORT_SECURITY,
      "strictTransportSecurity"
    );
    if (strictTransportSecurity) {
      headers.push(["strict-transport-security", strictTransportSecurity]);
    }
    headers.push(...resolveContentSecurityPolicyHeaders(settings));
  }
  return Object.freeze(headers.map((header) => Object.freeze(header)));
}

/**
 * Adds the security headers `config.securityHeaders` describes to every response the server
 * sends, leaving any a route set itself. Register it before any plugin, so every plugin's routes
 * inherit it; `createInstalledRuntime` does.
 * @param {RuntimeFastify} fastify
 * @param {{ config: RuntimeConfig, env: RuntimeEnv }} settings
 */
function registerSecurityHeaders(fastify, { config, env }) {
  const headers = resolveSecurityHeaders({ config, env });
  if (headers.length < 1) {
    return;
  }
  fastify.addHook("onSend", async (request, reply, payload) => {
    for (const [name, value] of headers) {
      if (!reply.hasHeader(name) && !reply.raw.hasHeader(name)) {
        reply.header(name, value);
      }
    }
    return payload;
  });
}

export { registerSecurityHeaders };
