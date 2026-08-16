import { DEV_AUTH_SECRET_HEADER } from "@jskit-ai/auth-core/server/devAuth";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";

const MANAGED_PREVIEW_IDENTITY_PROTOCOL = "genesis.preview-identity.command.v1";
const MANAGED_PREVIEW_IDENTITY_ENABLED_ENV = "AUTH_DEV_BYPASS_ENABLED";
const MANAGED_PREVIEW_IDENTITY_SECRET_ENV = "AUTH_DEV_BYPASS_SECRET";
const MAX_MESSAGE_BYTES = 64 * 1024;

function commandError(message, code = "jskit_managed_preview_identity_failed", details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function response(requestId, values) {
  return {
    protocol: MANAGED_PREVIEW_IDENTITY_PROTOCOL,
    requestId: String(requestId || ""),
    ...values
  };
}

function failure(requestId, error) {
  return response(requestId, {
    code: String(error?.code || "jskit_managed_preview_identity_failed"),
    error: String(error?.message || error || "Managed preview identity failed."),
    ok: false,
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

function localTargetOrigin(value) {
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
    /^vibe64-launch-[a-f0-9]{12}$/u.test(hostname);
  if (target.protocol !== "http:" || !local) {
    throw commandError(
      "Managed preview identity target must be a local application.",
      "jskit_managed_preview_identity_target_invalid"
    );
  }
  return target.origin;
}

function normalizeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw commandError(
      "Managed preview identity request must be an object.",
      "jskit_managed_preview_identity_request_invalid"
    );
  }
  const requestId = String(value.requestId || "").trim();
  const operation = String(value.operation || "").trim();
  if (value.protocol !== MANAGED_PREVIEW_IDENTITY_PROTOCOL || !requestId) {
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
    targetOrigin: localTargetOrigin(value.target?.origin || value.target?.href)
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

function responseCookies(fetchResponse) {
  if (typeof fetchResponse?.headers?.getSetCookie === "function") {
    return fetchResponse.headers.getSetCookie().map(String).filter(Boolean);
  }
  const value = String(fetchResponse?.headers?.get?.("set-cookie") || "").trim();
  return value ? [value] : [];
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

async function responsePayload(fetchResponse) {
  const text = fetchResponse?.body
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
    { statusCode: Number(fetchResponse?.status || 502), ...details }
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
  const setCookie = responseCookies(fetchResponse);
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
  return { csrfToken, setCookie };
}

async function logout(fetchImpl, targetOrigin, session) {
  const fetchResponse = await postJson(fetchImpl, `${targetOrigin}${AUTH_PATHS.LOGOUT}`, {}, {
    cookie: cookieHeader(session.setCookie),
    "csrf-token": session.csrfToken
  });
  const payload = await responsePayload(fetchResponse);
  const setCookie = [...session.setCookie, ...responseCookies(fetchResponse)];
  if (!fetchResponse.ok || payload?.ok !== true) {
    throw rejected(payload, fetchResponse, { setCookie, signedOut: false });
  }
  return { csrfToken: session.csrfToken, setCookie };
}

async function login(fetchImpl, targetOrigin, identity, secret, session) {
  const fetchResponse = await postJson(fetchImpl, `${targetOrigin}${AUTH_PATHS.DEV_LOGIN_AS}`, identity, {
    cookie: cookieHeader(session.setCookie),
    "csrf-token": session.csrfToken,
    [DEV_AUTH_SECRET_HEADER]: secret
  });
  const payload = await responsePayload(fetchResponse);
  const setCookie = [...session.setCookie, ...responseCookies(fetchResponse)];
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
    setCookie
  };
}

async function executeManagedPreviewIdentityRequest(value, {
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  let requestId = String(value?.requestId || "").trim();
  try {
    const request = normalizeRequest(value);
    requestId = request.requestId;
    if (typeof fetchImpl !== "function") {
      throw commandError(
        "Managed preview identity requires fetch support.",
        "jskit_managed_preview_identity_fetch_unavailable",
        { statusCode: 500 }
      );
    }
    if (String(env[MANAGED_PREVIEW_IDENTITY_ENABLED_ENV] || "").trim().toLowerCase() !== "true") {
      throw commandError(
        "Managed preview identity is not enabled.",
        "jskit_managed_preview_identity_disabled",
        { statusCode: 403 }
      );
    }
    const secret = String(env[MANAGED_PREVIEW_IDENTITY_SECRET_ENV] || "").trim();
    if (!/^[a-f0-9]{64}$/u.test(secret)) {
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
      return response(requestId, {
        identity: null,
        ok: true,
        setCookie: signedOutSession.setCookie,
        signedOut: true
      });
    }
    const result = await login(fetchImpl, request.targetOrigin, identity, secret, signedOutSession);
    return response(requestId, {
      identity: result.identity,
      ok: true,
      setCookie: result.setCookie,
      signedOut: false
    });
  } catch (error) {
    return failure(requestId, error);
  }
}

async function runManagedPreviewIdentityCommand({
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdin = process.stdin,
  stdout = process.stdout
} = {}) {
  let request;
  try {
    request = await readCommandInput(stdin);
  } catch (error) {
    stdout.write(`${JSON.stringify(failure("", error))}\n`);
    return 0;
  }
  const result = await executeManagedPreviewIdentityRequest(request, { env, fetchImpl });
  stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

export {
  MANAGED_PREVIEW_IDENTITY_PROTOCOL,
  executeManagedPreviewIdentityRequest,
  runManagedPreviewIdentityCommand
};
