/** @typedef {import("../types.js").RuntimeEnv} RuntimeEnv */
/** @typedef {import("../types.js").RuntimeFastify} RuntimeFastify */

// A host name: labels of letters, digits and inner hyphens, the last starting with a letter, 253 characters at most.
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;
const SETTING_HELP = "List the application's other names, comma-separated, such as APP_REDIRECT_HOSTS=www.example.com: "
  + "each is sent on to APP_PUBLIC_URL.";

/**
 * The origin requests for the other names go to, and those names, from APP_PUBLIC_URL and APP_REDIRECT_HOSTS; null
 * while APP_REDIRECT_HOSTS is unset or empty. A setting it can't follow throws, naming the fix.
 * @param {RuntimeEnv} env
 * @returns {{ origin: string, hosts: ReadonlySet<string> } | null}
 */
function resolveRedirectHosts(env) {
  const setting = String(env?.APP_REDIRECT_HOSTS ?? "").trim();
  if (!setting) {
    return null;
  }
  const address = String(env?.APP_PUBLIC_URL ?? "").trim();
  if (!address) {
    throw new TypeError("APP_REDIRECT_HOSTS sends its names to APP_PUBLIC_URL, which is not set. Set APP_PUBLIC_URL to the "
      + "address people use, such as https://example.com, or remove APP_REDIRECT_HOSTS.");
  }
  let publicUrl = null;
  try {
    publicUrl = new URL(address);
  } catch {
    // Refused below.
  }
  if (!publicUrl || !["http:", "https:"].includes(publicUrl.protocol)) {
    throw new TypeError(`APP_PUBLIC_URL is "${address}", which is not an http or https address. Set it to the address `
      + "people use, such as https://example.com.");
  }
  const hosts = new Set();
  for (const entry of setting.split(",").map((one) => one.trim()).filter(Boolean)) {
    const host = entry.toLowerCase();
    if (!HOST_NAME.test(host)) {
      throw new TypeError(`APP_REDIRECT_HOSTS has "${entry}", which is not a host name: no scheme, port, path or wildcard. ${SETTING_HELP}`);
    }
    if (host === publicUrl.hostname) {
      throw new TypeError(`APP_REDIRECT_HOSTS has ${host}, APP_PUBLIC_URL's own name, which would be sent on to itself: remove it from APP_REDIRECT_HOSTS.`);
    }
    hosts.add(host);
  }
  return hosts.size > 0 ? Object.freeze({ origin: publicUrl.origin, hosts }) : null;
}

/**
 * Sends a request for one of the application's other names (APP_REDIRECT_HOSTS, such as www.example.com) on to the
 * same path and query at APP_PUBLIC_URL's origin, with a 301, before any route answers it. The name is the one the
 * request was sent to as Fastify reads it (`request.hostname`): its Host, or the X-Forwarded-Host of a proxy that
 * `trustProxy` (TRUSTED_PROXIES) believes, so a client's own header changes nothing. Every other name, the main one
 * and an instance's own name or address as a load balancer's health check sends it among them, is served as before.
 * A setting it can't follow stops the server from starting. Register it before any plugin, so every route and the
 * not-found handler inherit it; `createInstalledRuntime` does.
 * @param {RuntimeFastify} fastify
 * @param {{ env: RuntimeEnv }} settings
 */
function registerRedirectHosts(fastify, { env }) {
  const redirect = resolveRedirectHosts(env);
  if (!redirect) {
    return;
  }
  const { origin, hosts } = redirect;
  fastify.addHook("onRequest", async (request, reply) => {
    const host = String(request.hostname || "").toLowerCase().replace(/\.$/u, "");
    if (!hosts.has(host)) {
      return;
    }
    // The request's own path and query, which always start with "/" here: a path that reads like a host
    // ("//elsewhere.example/x") stays a path on APP_PUBLIC_URL's host.
    const target = String(request.raw.url || "/");
    return reply.redirect(`${origin}${target.startsWith("/") ? target : "/"}`, 301);
  });
}

export { registerRedirectHosts, resolveRedirectHosts };
