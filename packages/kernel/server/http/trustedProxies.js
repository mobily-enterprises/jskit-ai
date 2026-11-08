import { isIP, isIPv4 } from "node:net";

/** @typedef {import("../types.js").RuntimeEnv} RuntimeEnv */

// The names Fastify's trustProxy (proxy-addr) gives ranges: 127.0.0.1/8 and ::1, 169.254.0.0/16 and fe80::/10,
// the private ranges 10/8, 172.16/12, 192.168/16 and fc00::/7.
const RANGE_NAMES = Object.freeze(["loopback", "linklocal", "uniquelocal"]);
// With nothing set, only a proxy on the server's own machine is believed.
const DEFAULT_TRUSTED_PROXIES = Object.freeze(["loopback"]);
const SETTING_HELP = "List the addresses or ranges of the proxies in front of the server, comma-separated, such as "
  + "TRUSTED_PROXIES=loopback,10.0.0.5 or TRUSTED_PROXIES=10.0.0.0/24.";

/**
 * Whether `entry` is an address, a range (address/prefix length, or an IPv4 address/netmask) or a range name.
 * @param {string} entry
 */
function isProxyRange(entry) {
  if (RANGE_NAMES.includes(entry)) {
    return true;
  }
  const [address, prefix, ...rest] = entry.split("/");
  const family = isIP(address);
  if (family === 0 || rest.length > 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  if (/^\d+$/u.test(prefix)) {
    return Number(prefix) <= (family === 4 ? 32 : 128);
  }
  return family === 4 && isIPv4(prefix);
}

/**
 * Fastify's `trustProxy` from the TRUSTED_PROXIES setting: the proxies whose X-Forwarded-For (and -Host and -Proto)
 * the server believes, so `request.ip`, and every rate limit counted by it, is the client's address behind them and
 * a client's own X-Forwarded-For changes nothing. Without the setting only a proxy on the same machine (loopback) is
 * believed. `true` and hop counts are refused, because they believe a header any client can send.
 * @param {RuntimeEnv} env The environment the server starts with.
 * @returns {string[]} The addresses, ranges and range names, in proxy-addr's syntax.
 */
function resolveTrustedProxies(env) {
  const setting = String(env?.TRUSTED_PROXIES ?? "").trim();
  if (!setting) {
    return [...DEFAULT_TRUSTED_PROXIES];
  }
  const entries = setting.split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (/^true$/iu.test(entry)) {
      throw new TypeError(
        `TRUSTED_PROXIES=${setting} believes every request's X-Forwarded-For, so any client could choose its own address. ${SETTING_HELP}`
      );
    }
    if (/^\d+$/u.test(entry)) {
      throw new TypeError(
        `TRUSTED_PROXIES=${setting} is a hop count, which believes X-Forwarded-For from whoever sends it, so any client could choose its own address. ${SETTING_HELP}`
      );
    }
    if (!isProxyRange(entry)) {
      throw new TypeError(`TRUSTED_PROXIES has "${entry}", which is not an address, a range or loopback, linklocal or uniquelocal. ${SETTING_HELP}`);
    }
  }
  return entries.length > 0 ? entries : [...DEFAULT_TRUSTED_PROXIES];
}

export { DEFAULT_TRUSTED_PROXIES, resolveTrustedProxies };
