const PROTOCOL = "vibe64.preview-identity.command.v1";
const MAX_MESSAGE_BYTES = 64 * 1024;

function failure(requestId, code, message, statusCode = 400) {
  return { protocol: PROTOCOL, requestId, ok: false, code, error: message, setCookie: [], signedOut: false, statusCode };
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

function localOrigin(value) {
  const target = new URL(String(value || ""));
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const local = host === "localhost" || host.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/u.test(host) ||
    host === "::1" || /^vibe64-launch-[a-f0-9]{12}$/u.test(host);
  if (target.protocol !== "http:" || !local) throw new Error("The preview identity target must be a local application.");
  return target.origin;
}

function setCookies(response) {
  return typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
}

/**
 * The hub's side of the editor preview identity protocol: it signs the
 * preview browser in as an existing hub account through the hub's
 * development-only exchange, which needs the exchange secret and a loopback
 * caller and is absent in production.
 */
async function executePreviewIdentityRequest(request, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const requestId = String(request?.requestId || "");
  if (request?.protocol !== PROTOCOL || !requestId || !["login-as", "logout"].includes(request.operation)) {
    return failure(requestId, "preview_identity_request_invalid", "The preview identity request is invalid.");
  }
  if (String(env.AUTH_DEV_BYPASS_ENABLED || "").trim().toLowerCase() !== "true") {
    return failure(requestId, "preview_identity_disabled", "Preview identity is not enabled.", 403);
  }
  let origin;
  try {
    origin = localOrigin(request.target?.origin || request.target?.href);
  } catch (error) {
    return failure(requestId, "preview_identity_target_invalid", error.message);
  }
  const headers = { "content-type": "application/json", "x-hub-request": "1" };
  try {
    const signOut = await fetchImpl(`${origin}/hub/api/sign-out`, { method: "POST", headers, body: "{}" });
    if (request.operation === "logout") {
      return { protocol: PROTOCOL, requestId, ok: true, identity: null, setCookie: setCookies(signOut), signedOut: true };
    }
    const selector = request.subject?.kind === "selector" ? request.subject.selector : null;
    const value = String(selector?.value || "").trim();
    const identity = selector?.type === "email" ? { email: value } : selector?.type === "user-id" ? { userId: value } : null;
    if (!identity || !value) {
      return failure(requestId, "preview_identity_selector_unsupported", "Name an existing hub account by email or user id.");
    }
    const response = await fetchImpl(`${origin}/hub/api/dev/login-as`, {
      method: "POST",
      headers: { ...headers, "x-jskit-dev-auth-secret": String(env.AUTH_DEV_BYPASS_SECRET || "") },
      body: JSON.stringify(identity)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      return failure(requestId, payload.error || "preview_identity_rejected", payload.message || "The hub refused the preview sign-in.", response.status);
    }
    return {
      protocol: PROTOCOL,
      requestId,
      ok: true,
      identity: { displayName: payload.displayName, email: payload.email, userId: payload.userId, username: "" },
      setCookie: setCookies(response),
      signedOut: false
    };
  } catch {
    return failure(requestId, "preview_identity_unreachable", "The hub could not be reached.", 502);
  }
}

async function runPreviewIdentityCommand({ env = process.env, fetchImpl = globalThis.fetch, stdin = process.stdin, stdout = process.stdout } = {}) {
  let request = null;
  try {
    request = await readInput(stdin);
  } catch (error) {
    stdout.write(`${JSON.stringify(failure("", "preview_identity_request_invalid", error.message))}\n`);
    return 0;
  }
  stdout.write(`${JSON.stringify(await executePreviewIdentityRequest(request, { env, fetchImpl }))}\n`);
  return 0;
}

export { executePreviewIdentityRequest, runPreviewIdentityCommand };
