// The test network guard: a test, and every app server and process it starts, reaches only this machine and the test
// database. `jskit test` and the browser test servers give their processes NODE_OPTIONS with the guard's preload
// (test-network-guard-preload.mjs), so a process those start with the same environment is guarded too. Every outbound
// TCP connection a guarded Node process makes passes through net.Socket.prototype.connect (net.connect, tls.connect,
// http and https agents, fetch); the guard lets through loopback addresses, `localhost` names, unix sockets and named
// pipes, and the database host the environment names (DB_HOST, DATABASE_URL's host, read when the connection is made),
// and refuses every other host before any name is looked up: the socket fails with JSKIT_TEST_NETWORK_REFUSED, naming
// the host and the fix, and the same line goes to stderr once per host, so an app that swallows the error still shows
// it. A test that reaches a real outside service (an AI provider, a payment or mail API, a hosting API) costs money,
// sends real messages or changes real data whenever a developer's keys sit in the environment the test inherits. A file
// that must reach one says why on its first line, `// jskit-test: network - <reason>`, and `jskit test` runs it
// without the guard (test-command.mjs).
import net from "node:net";
import process from "node:process";

const NETWORK_REFUSED_CODE = "JSKIT_TEST_NETWORK_REFUSED";
// Names the command whose processes are guarded, for the refusal: `jskit test` or `jskit browser tests`.
const NETWORK_GUARD_VARIABLE = "JSKIT_TEST_NETWORK_GUARD";
const NETWORK_GUARD_PRELOAD = new URL("./test-network-guard-preload.mjs", import.meta.url).href;
const PRELOAD_OPTION = `--import=${NETWORK_GUARD_PRELOAD}`;
const INSTALLED = Symbol.for("@jskit-ai/jskit-catalog/testNetworkGuard");
const BROWSER_TESTS = "jskit browser tests";

// This machine: IPv4 loopback, IPv6 loopback and IPv4 loopback mapped into IPv6, and the unspecified addresses, which
// a connection on Linux reaches as this machine (a test connecting to the address its server listened on, `::`).
const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("0.0.0.0", "ipv4");
LOOPBACK.addAddress("::1", "ipv6");
LOOPBACK.addAddress("::", "ipv6");
LOOPBACK.addSubnet("::ffff:127.0.0.0", 104, "ipv6");

const hostName = (host) => String(host ?? "").trim().toLowerCase().replace(/^\[(.*)\]$/u, "$1").replace(/\.$/u, "");

/** The database hosts the environment names now: DB_HOST, and DATABASE_URL's host. */
function databaseHosts(env) {
  const hosts = [hostName(env.DB_HOST)];
  try {
    hosts.push(hostName(new URL(String(env.DATABASE_URL ?? "")).hostname));
  } catch {
    // No DATABASE_URL, or one that names no host.
  }
  return hosts.filter(Boolean);
}

/**
 * Whether a guarded test process may connect to `host`: loopback, a `localhost` name, or a database host `env` names.
 * @param {string} host
 * @param {Record<string, string | undefined>} env
 */
function isAllowedTestHost(host, env) {
  const name = hostName(host);
  if (name === "localhost" || name.endsWith(".localhost") || databaseHosts(env).includes(name)) return true;
  const family = net.isIP(name);
  return family !== 0 && LOOPBACK.check(name, family === 4 ? "ipv4" : "ipv6");
}

/** NODE_OPTIONS without the guard's preload. */
function withoutNetworkGuard(nodeOptions) {
  return String(nodeOptions ?? "").split(PRELOAD_OPTION).map((part) => part.trim()).filter(Boolean).join(" ");
}

/**
 * The variables that guard the processes started with them: NODE_OPTIONS with the guard's preload added once, and the
 * command that guards them, for the refusal.
 * @param {Record<string, string | undefined>} env the environment the processes would get
 * @param {string} command `jskit test` or `jskit browser tests`
 */
function networkGuardEnvironment(env, command) {
  return {
    NODE_OPTIONS: [withoutNetworkGuard(env.NODE_OPTIONS), PRELOAD_OPTION].filter(Boolean).join(" "),
    [NETWORK_GUARD_VARIABLE]: command
  };
}

function refusal(command, host, port) {
  const target = `${host}${port ? `:${port}` : ""}`;
  const fix = command === BROWSER_TESTS
    ? "Stub it at the seam the app already uses: a test-only driver or env value, in browserTestConfig()'s `env` or its " +
      "`prepare` module, pointing at a local fake."
    : "Stub it at the seam the app already uses (an injected client or provider double, a test-only env value pointing " +
      "at a local fake); a test file that must reach it says why on its first line: `// jskit-test: network - <reason>`.";
  const error = new Error(`${command} refused a connection to ${target}: tests never reach an outside service. ${fix} ` +
    "Tests reach only loopback, unix sockets and the database host (DB_HOST, DATABASE_URL).");
  return Object.assign(error, { code: NETWORK_REFUSED_CODE, host, port });
}

/** Where a call to net.Socket.prototype.connect goes, as net reads its arguments: a path, or a host and port. */
function connectTarget(args) {
  let first = args[0];
  // net.connect() hands the socket its arguments already read, as an array.
  if (Array.isArray(first)) first = first[0];
  if (first !== null && typeof first === "object") {
    if (first.path) return { path: String(first.path) };
    return { host: first.host || "localhost", port: first.port };
  }
  if (typeof first === "string" && !/^\s*\d+\s*$/u.test(first)) return { path: first };
  return { host: typeof args[1] === "string" && args[1] ? args[1] : "localhost", port: first };
}

/**
 * Guards this process's outbound connections. Calling it again changes nothing.
 * @param {{ env?: Record<string, string | undefined>, command?: string, stderr?: { write(text: string): unknown } }} [options]
 */
function installNetworkGuard({ env = process.env, command = env[NETWORK_GUARD_VARIABLE] || "jskit test", stderr = process.stderr } = {}) {
  if (net.Socket.prototype.connect[INSTALLED]) return;
  const connect = net.Socket.prototype.connect;
  const reported = new Set();
  function guardedConnect(...args) {
    const target = connectTarget(args);
    if (target.path !== undefined || isAllowedTestHost(target.host, env)) return connect.apply(this, args);
    const error = refusal(command, hostName(target.host), target.port);
    if (!reported.has(error.host)) {
      reported.add(error.host);
      stderr.write(`${error.message}\n`);
    }
    // As a failed connection does: the error comes after connect() returns, so its caller's listeners hear it.
    process.nextTick(() => this.destroy(error));
    return this;
  }
  guardedConnect[INSTALLED] = true;
  net.Socket.prototype.connect = guardedConnect;
}

export {
  NETWORK_GUARD_PRELOAD,
  NETWORK_GUARD_VARIABLE,
  NETWORK_REFUSED_CODE,
  installNetworkGuard,
  isAllowedTestHost,
  networkGuardEnvironment,
  withoutNetworkGuard
};
