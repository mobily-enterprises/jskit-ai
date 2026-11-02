import { DEV_AUTH_SECRET_HEADER, resolveHubDevAuth } from "./config.js";

/**
 * The protocol id the command speaks when the hub names none. A preview host
 * that names its own id is configured through the `protocol` option.
 */
const DEFAULT_PREVIEW_IDENTITY_PROTOCOL = "jskit.preview-identity.command.v1";
const MAX_MESSAGE_BYTES = 64 * 1024;

function failure(protocol, requestId, code, message, statusCode = 400) {
  // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
  return { protocol, requestId, ok: false, code, error: message, setCookie: [], signedOut: false, statusCode };
}

async function readInput(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_MESSAGE_BYTES) throw new Error("The preview identity request is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * @param {unknown} value
 * @param {RegExp[]} localHostnames
 */
function localOrigin(value, localHostnames) {
  const target = new URL(String(value || ""));
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const local = host === "localhost" || host.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/u.test(host) ||
    host === "::1" || localHostnames.some((pattern) => pattern.test(host));
  if (target.protocol !== "http:" || !local) throw new Error("The preview identity target must be a local application.");
  return target.origin;
}

/**
 * The hub's side of the editor preview identity protocol: it signs the
 * preview browser in as an existing hub account through the hub's
 * development-only exchange, which needs the exchange secret and a loopback
 * caller and is absent in production. The preview host names the protocol id
 * and any hostnames, besides loopback, that it serves the hub on.
 * @param {Record<string, any>} request The command's request, which is validated here.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env The hub's environment, such as `process.env`.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.protocol] The protocol id requests carry and responses echo.
 * @param {RegExp[]} [options.localHostnames] Hostnames, besides loopback, the hub is served on.
 */
async function executePreviewIdentityRequest(request, {
  env,
  fetchImpl = globalThis.fetch,
  protocol = DEFAULT_PREVIEW_IDENTITY_PROTOCOL,
  localHostnames = []
}) {
  if (!env) {
    throw new TypeError("executePreviewIdentityRequest requires the hub's environment, such as process.env.");
  }
  const requestId = String(request?.requestId || "");
  if (request?.protocol !== protocol || !requestId || !["login-as", "logout"].includes(request.operation)) {
    return failure(protocol, requestId, "preview_identity_request_invalid", "The preview identity request is invalid.");
  }
  const devAuth = resolveHubDevAuth(env);
  if (!devAuth.enabled) {
    return failure(protocol, requestId, "preview_identity_disabled", "Preview identity is not enabled.", 403);
  }
  let origin;
  try {
    origin = localOrigin(request.target?.origin || request.target?.href, localHostnames);
  } catch (error) {
    return failure(protocol, requestId, "preview_identity_target_invalid", error.message);
  }
  const headers = { "content-type": "application/json", "x-hub-request": "1" };
  try {
    const signOut = await fetchImpl(`${origin}/hub/api/sign-out`, { method: "POST", headers, body: "{}" });
    if (request.operation === "logout") {
      // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
      return { protocol, requestId, ok: true, identity: null, setCookie: signOut.headers.getSetCookie(), signedOut: true };
    }
    const selector = request.subject?.kind === "selector" ? request.subject.selector : null;
    const value = String(selector?.value || "").trim();
    const identity = selector?.type === "email" ? { email: value } : selector?.type === "user-id" ? { userId: value } : null;
    if (!identity || !value) {
      return failure(protocol, requestId, "preview_identity_selector_unsupported", "Name an existing hub account by email or user id.");
    }
    const response = await fetchImpl(`${origin}/hub/api/dev/login-as`, {
      method: "POST",
      headers: { ...headers, [DEV_AUTH_SECRET_HEADER]: devAuth.secret },
      body: JSON.stringify(identity)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      return failure(protocol, requestId, payload.error || "preview_identity_rejected", payload.message || "The hub refused the preview sign-in.", response.status);
    }
    return {
      protocol,
      requestId,
      ok: true,
      identity: { displayName: payload.displayName, email: payload.email, userId: payload.userId, username: "" },
      // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
      setCookie: response.headers.getSetCookie(),
      signedOut: false
    };
  } catch {
    return failure(protocol, requestId, "preview_identity_unreachable", "The hub could not be reached.", 502);
  }
}

/**
 * Reads one request from stdin and writes its response to stdout.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env The hub's environment, such as `process.env`.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {AsyncIterable<string | Buffer>} [options.stdin]
 * @param {{ write(text: string): unknown }} [options.stdout]
 * @param {string} [options.protocol] The protocol id requests carry and responses echo.
 * @param {RegExp[]} [options.localHostnames] Hostnames, besides loopback, the hub is served on.
 */
async function runPreviewIdentityCommand({
  env,
  fetchImpl = globalThis.fetch,
  stdin = process.stdin,
  stdout = process.stdout,
  protocol = DEFAULT_PREVIEW_IDENTITY_PROTOCOL,
  localHostnames = []
}) {
  let request = null;
  try {
    request = await readInput(stdin);
  } catch (error) {
    stdout.write(`${JSON.stringify(failure(protocol, "", "preview_identity_request_invalid", error.message))}\n`);
    return 0;
  }
  stdout.write(`${JSON.stringify(await executePreviewIdentityRequest(request, { env, fetchImpl, protocol, localHostnames }))}\n`);
  return 0;
}

export { DEFAULT_PREVIEW_IDENTITY_PROTOCOL, executePreviewIdentityRequest, runPreviewIdentityCommand };
