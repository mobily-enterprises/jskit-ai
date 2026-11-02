import {
  DEV_AUTH_SECRET_HEADER,
  isDevAuthBootstrapEnabled,
  resolveDevAuthPolicyFromEnv
} from "@jskit-ai/auth-core/server/devAuth";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

/**
 * The protocol id the command speaks when the application names none. A preview
 * host that names its own id is configured through the command's `protocol`
 * option.
 */
const DEFAULT_PREVIEW_IDENTITY_PROTOCOL = "jskit.preview-identity.command.v1";
const MAX_MESSAGE_BYTES = 64 * 1024;

function commandError(message, code = "jskit_managed_preview_identity_failed", details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function response(protocol, requestId, values) {
  return {
    protocol,
    requestId: String(requestId || ""),
    ...values
  };
}

function failure(protocol, requestId, error) {
  return response(protocol, requestId, {
    code: String(error?.code || "jskit_managed_preview_identity_failed"),
    error: String(error?.message || error || "Managed preview identity failed."),
    ok: false,
    // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
    setCookie: Array.isArray(error?.setCookie) ? error.setCookie : [],
    signedOut: error?.signedOut === true,
    statusCode: Number.isInteger(Number(error?.statusCode)) ? Number(error.statusCode) : 400
  });
}

async function readBoundedStream(stream, label) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_MESSAGE_BYTES) {
      throw commandError(
        `${label} is too large.`,
        "jskit_managed_preview_identity_message_too_large",
        { statusCode: 413 }
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readCommandInput(stream) {
  try {
    return JSON.parse(await readBoundedStream(stream, "Managed preview identity request"));
  } catch (error) {
    if (error?.code) {
      throw error;
    }
    throw commandError(
      "Managed preview identity request is invalid JSON.",
      "jskit_managed_preview_identity_request_invalid"
    );
  }
}

/**
 * @param {unknown} value
 * @param {RegExp[]} localHostnames
 */
function localTargetOrigin(value, localHostnames) {
  let target;
  try {
    target = new URL(String(value || ""));
  } catch {
    throw commandError(
      "Managed preview identity target must be a local application.",
      "jskit_managed_preview_identity_target_invalid"
    );
  }
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const local = hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname === "::1" ||
    localHostnames.some((pattern) => pattern.test(hostname));
  if (target.protocol !== "http:" || !local) {
    throw commandError(
      "Managed preview identity target must be a local application.",
      "jskit_managed_preview_identity_target_invalid"
    );
  }
  return target.origin;
}

/**
 * @param {unknown} value
 * @param {{ protocol: string, localHostnames: RegExp[] }} host
 */
function normalizeRequest(value, { protocol, localHostnames }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw commandError(
      "Managed preview identity request must be an object.",
      "jskit_managed_preview_identity_request_invalid"
    );
  }
  const requestId = String(value.requestId || "").trim();
  const operation = String(value.operation || "").trim();
  if (value.protocol !== protocol || !requestId) {
    throw commandError(
      "Managed preview identity request protocol is invalid.",
      "jskit_managed_preview_identity_protocol_invalid"
    );
  }
  if (!["login-as", "logout"].includes(operation)) {
    throw commandError(
      "Managed preview identity operation is invalid.",
      "jskit_managed_preview_identity_operation_invalid"
    );
  }
  return {
    operation,
    requestId,
    subject: value.subject,
    targetOrigin: localTargetOrigin(value.target?.origin || value.target?.href, localHostnames)
  };
}

function identityFromSubject(subject) {
  if (subject?.kind === "selector") {
    const type = String(subject.selector?.type || "").trim();
    const value = String(subject.selector?.value || "").trim();
    if (type === "email" && value) {
      return { email: value };
    }
    if (type === "user-id" && value) {
      return { userId: value };
    }
  }
  throw commandError(
    "Managed preview identity requires an existing application email or user ID.",
    "jskit_managed_preview_identity_selector_unsupported"
  );
}

function cookieHeader(setCookie) {
  const cookies = new Map();
  for (const entry of setCookie) {
    const pair = String(entry || "").split(";", 1)[0].trim();
    const separator = pair.indexOf("=");
    if (separator > 0) {
      cookies.set(pair.slice(0, separator).trim(), pair);
    }
  }
  return [...cookies.values()].join("; ");
}

/** @param {Response} fetchResponse */
async function responsePayload(fetchResponse) {
  const text = fetchResponse.body
    ? await readBoundedStream(fetchResponse.body, "Managed preview identity response")
    : "";
  if (!text) {
    return null;
  }
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {object | null} payload The response's JSON body, when it has one.
 * @param {Response} fetchResponse
 * @param {object} [details]
 */
function rejected(payload, fetchResponse, details = {}) {
  const fieldErrors = payload?.details?.fieldErrors || payload?.fieldErrors || {};
  const fieldMessage = Object.values(
    fieldErrors && typeof fieldErrors === "object" && !Array.isArray(fieldErrors) ? fieldErrors : {}
  ).find(Boolean);
  const firstError = Array.isArray(payload?.errors) ? payload.errors.find(Boolean) : null;
  return commandError(
    String(
      fieldMessage ||
      firstError?.message ||
      firstError ||
      payload?.error ||
      payload?.message ||
      "Managed preview identity exchange failed."
    ),
    String(firstError?.code || payload?.code || "jskit_managed_preview_identity_rejected"),
    { statusCode: Number(fetchResponse.status || 502), ...details }
  );
}

async function fetchRequest(fetchImpl, href, options) {
  try {
    return await fetchImpl(href, options);
  } catch {
    throw commandError(
      "Managed preview identity could not reach the application.",
      "jskit_managed_preview_identity_unreachable",
      { statusCode: 502 }
    );
  }
}

function postJson(fetchImpl, href, body, headers = {}) {
  return fetchRequest(fetchImpl, href, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
    redirect: "manual"
  });
}

async function bootstrapSession(fetchImpl, targetOrigin) {
  const fetchResponse = await fetchRequest(fetchImpl, `${targetOrigin}${AUTH_PATHS.SESSION}`, {
    method: "GET",
    redirect: "manual"
  });
  const payload = await responsePayload(fetchResponse);
  const setCookie = fetchResponse.headers.getSetCookie();
  if (!fetchResponse.ok) {
    throw rejected(payload, fetchResponse, { setCookie });
  }
  const csrfToken = String(payload?.csrfToken || "").trim();
  if (!csrfToken) {
    throw commandError(
      "Session bootstrap did not return a CSRF token.",
      "jskit_managed_preview_identity_csrf_missing",
      { setCookie, statusCode: 502 }
    );
  }
  // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
  return { csrfToken, setCookie };
}

async function logout(fetchImpl, targetOrigin, session) {
  const fetchResponse = await postJson(fetchImpl, `${targetOrigin}${AUTH_PATHS.LOGOUT}`, {}, {
    cookie: cookieHeader(session.setCookie),
    "csrf-token": session.csrfToken
  });
  const payload = await responsePayload(fetchResponse);
  const setCookie = [...session.setCookie, ...fetchResponse.headers.getSetCookie()];
  if (!fetchResponse.ok || payload?.ok !== true) {
    throw rejected(payload, fetchResponse, { setCookie, signedOut: false });
  }
  // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
  return { csrfToken: session.csrfToken, setCookie };
}

async function login(fetchImpl, targetOrigin, identity, secret, session) {
  const fetchResponse = await postJson(fetchImpl, `${targetOrigin}${AUTH_PATHS.DEV_LOGIN_AS}`, identity, {
    cookie: cookieHeader(session.setCookie),
    "csrf-token": session.csrfToken,
    [DEV_AUTH_SECRET_HEADER]: secret
  });
  const payload = await responsePayload(fetchResponse);
  const setCookie = [...session.setCookie, ...fetchResponse.headers.getSetCookie()];
  if (!fetchResponse.ok || payload?.ok !== true) {
    throw rejected(payload, fetchResponse, { setCookie, signedOut: true });
  }
  return {
    identity: {
      displayName: String(payload.displayName || payload.username || "").trim(),
      email: String(payload.email || identity.email || "").trim().toLowerCase(),
      userId: String(payload.userId || identity.userId || "").trim(),
      username: String(payload.username || "").trim()
    },
    // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
    setCookie
  };
}

/**
 * Answers one preview identity request: signs the preview browser out, and for
 * `login-as` back in as an existing application user, through the development
 * exchange. The preview host names the protocol id and any hostnames, besides
 * loopback, that it serves the application on.
 * @param {Record<string, any>} value The command's request, which is validated here.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env The application's environment, such as `process.env`.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.protocol] The protocol id requests carry and responses echo.
 * @param {RegExp[]} [options.localHostnames] Hostnames, besides loopback, the application is served on.
 */
async function executeManagedPreviewIdentityRequest(value, {
  env,
  fetchImpl = globalThis.fetch,
  protocol = DEFAULT_PREVIEW_IDENTITY_PROTOCOL,
  localHostnames = []
}) {
  if (!env) {
    throw new TypeError("executeManagedPreviewIdentityRequest requires the application's environment, such as process.env.");
  }
  let requestId = String(value?.requestId || "").trim();
  try {
    const request = normalizeRequest(value, { protocol, localHostnames });
    requestId = request.requestId;
    // readable-check: allow method-probe - input validation: the fetch an application passes
    if (typeof fetchImpl !== "function") {
      throw commandError(
        "Managed preview identity requires fetch support.",
        "jskit_managed_preview_identity_fetch_unavailable",
        { statusCode: 500 }
      );
    }
    const devAuth = resolveDevAuthPolicyFromEnv(env);
    if (!isDevAuthBootstrapEnabled(devAuth)) {
      throw commandError(
        "Managed preview identity is not enabled.",
        "jskit_managed_preview_identity_disabled",
        { statusCode: 403 }
      );
    }
    if (!devAuth.secret) {
      throw commandError(
        "Managed preview identity secret is unavailable.",
        "jskit_managed_preview_identity_secret_missing",
        { statusCode: 500 }
      );
    }
    const identity = request.operation === "login-as"
      ? identityFromSubject(request.subject)
      : null;
    const session = await bootstrapSession(fetchImpl, request.targetOrigin);
    const signedOutSession = await logout(fetchImpl, request.targetOrigin, session);
    if (request.operation === "logout") {
      return response(protocol, requestId, {
        identity: null,
        ok: true,
        // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
        setCookie: signedOutSession.setCookie,
        signedOut: true
      });
    }
    const result = await login(fetchImpl, request.targetOrigin, identity, devAuth.secret, signedOutSession);
    return response(protocol, requestId, {
      identity: result.identity,
      ok: true,
      // readable-check: allow setter-seam - not a slot: setCookie is the preview identity protocol's list of Set-Cookie headers
      setCookie: result.setCookie,
      signedOut: false
    });
  } catch (error) {
    return failure(protocol, requestId, error);
  }
}

/**
 * Reads one request from stdin and writes its response to stdout.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env The application's environment, such as `process.env`.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {AsyncIterable<string | Buffer>} [options.stdin]
 * @param {{ write(text: string): unknown }} [options.stdout]
 * @param {string} [options.protocol] The protocol id requests carry and responses echo.
 * @param {RegExp[]} [options.localHostnames] Hostnames, besides loopback, the application is served on.
 */
async function runManagedPreviewIdentityCommand({
  env,
  fetchImpl = globalThis.fetch,
  stdin = process.stdin,
  stdout = process.stdout,
  protocol = DEFAULT_PREVIEW_IDENTITY_PROTOCOL,
  localHostnames = []
}) {
  let request;
  try {
    request = await readCommandInput(stdin);
  } catch (error) {
    stdout.write(`${JSON.stringify(failure(protocol, "", error))}\n`);
    return 0;
  }
  const result = await executeManagedPreviewIdentityRequest(request, { env, fetchImpl, protocol, localHostnames });
  stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

export {
  DEFAULT_PREVIEW_IDENTITY_PROTOCOL,
  executeManagedPreviewIdentityRequest,
  runManagedPreviewIdentityCommand
};
