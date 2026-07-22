const PREVIEW_IDENTITY_PROTOCOL = "vibe64.preview-identity.command.v1";
const PREVIEW_IDENTITY_LOGIN_OPERATION = "login-as";
const PREVIEW_IDENTITY_LOGOUT_OPERATION = "logout";
const PREVIEW_IDENTITY_INPUT_LIMIT_BYTES = 64 * 1024;
const PREVIEW_IDENTITY_RESPONSE_LIMIT_BYTES = 64 * 1024;
const PREVIEW_IDENTITY_ENABLED_ENV = "VIBE64_PREVIEW_IDENTITY_ENABLED";
const PREVIEW_IDENTITY_SECRET_ENV = "VIBE64_PREVIEW_IDENTITY_SECRET";
const DEV_AUTH_SECRET_HEADER = "x-jskit-dev-auth-secret";
const AUTH_PATHS = Object.freeze({
  devLoginAs: "/api/dev-auth/login-as",
  logout: "/api/logout",
  session: "/api/session"
});

function previewIdentityResponse(requestId = "", values = {}) {
  return {
    protocol: PREVIEW_IDENTITY_PROTOCOL,
    requestId: String(requestId || ""),
    ...values
  };
}

function previewIdentityFailure(requestId = "", error = {}) {
  return previewIdentityResponse(requestId, {
    code: String(error.code || "jskit_preview_identity_failed"),
    error: String(error.message || error || "JSKIT preview identity failed."),
    ok: false,
    setCookie: Array.isArray(error.setCookie) ? error.setCookie : [],
    signedOut: error.signedOut === true,
    statusCode: Number.isInteger(Number(error.statusCode)) ? Number(error.statusCode) : 400
  });
}

function commandError(message = "", code = "jskit_preview_identity_failed", extra = {}) {
  const error = new Error(message || "JSKIT preview identity failed.");
  error.code = code;
  Object.assign(error, extra);
  return error;
}

async function readInput(stream) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > PREVIEW_IDENTITY_INPUT_LIMIT_BYTES) {
      throw commandError(
        "Preview identity request is too large.",
        "jskit_preview_identity_request_too_large",
        { statusCode: 413 }
      );
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw commandError(
      "Preview identity request is invalid JSON.",
      "jskit_preview_identity_request_invalid"
    );
  }
}

function normalizeRequest(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw commandError(
      "Preview identity request must be an object.",
      "jskit_preview_identity_request_invalid"
    );
  }
  const requestId = String(value.requestId || "").trim();
  const operation = String(value.operation || "").trim();
  if (value.protocol !== PREVIEW_IDENTITY_PROTOCOL || !requestId) {
    throw commandError(
      "Preview identity request protocol is invalid.",
      "jskit_preview_identity_protocol_invalid"
    );
  }
  if (![PREVIEW_IDENTITY_LOGIN_OPERATION, PREVIEW_IDENTITY_LOGOUT_OPERATION].includes(operation)) {
    throw commandError(
      "Preview identity operation is invalid.",
      "jskit_preview_identity_operation_invalid"
    );
  }
  let target;
  try {
    target = new URL(String(value.target?.origin || value.target?.href || ""));
  } catch {
    throw commandError(
      "Preview identity target must be a local JSKIT application.",
      "jskit_preview_identity_target_invalid"
    );
  }
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    target.protocol !== "http:" ||
    !(
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/u.test(hostname) ||
      hostname === "::1" ||
      /^vibe64-launch-[a-f0-9]{12}$/u.test(hostname)
    )
  ) {
    throw commandError(
      "Preview identity target must be a local JSKIT application.",
      "jskit_preview_identity_target_invalid"
    );
  }
  return {
    operation,
    requestId,
    subject: value.subject,
    targetOrigin: target.origin
  };
}

function identityFromSubject(subject = {}) {
  const source = subject && typeof subject === "object" && !Array.isArray(subject) ? subject : {};
  if (source.kind === "selector") {
    const type = String(source.selector?.type || "").trim();
    const value = String(source.selector?.value || "").trim();
    if (type === "email" && value) {
      return { email: value };
    }
    if (type === "user-id" && value) {
      return { userId: value };
    }
  }
  if (source.kind === "viewer") {
    const email = (Array.isArray(source.identifiers) ? source.identifiers : [])
      .find((identifier) => identifier?.type === "email" && String(identifier.value || "").trim());
    if (email) {
      return { email: String(email.value).trim() };
    }
  }
  throw commandError(
    "JSKIT preview identity requires an existing application email or user ID.",
    "jskit_preview_identity_selector_unsupported"
  );
}

function responseSetCookie(response = {}) {
  if (typeof response.headers?.getSetCookie === "function") {
    return response.headers.getSetCookie().map(String).filter(Boolean);
  }
  const value = String(response.headers?.get?.("set-cookie") || "").trim();
  return value ? [value] : [];
}

function cookieHeader(setCookie = []) {
  const cookies = new Map();
  for (const entry of Array.isArray(setCookie) ? setCookie : []) {
    const pair = String(entry || "").split(";", 1)[0].trim();
    const separatorIndex = pair.indexOf("=");
    const name = separatorIndex > 0 ? pair.slice(0, separatorIndex).trim() : "";
    if (name) {
      cookies.set(name, pair);
    }
  }
  return [...cookies.values()].join("; ");
}

async function responsePayload(response = {}) {
  const reader = response.body?.getReader?.();
  let text = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > PREVIEW_IDENTITY_RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw commandError(
          "JSKIT preview identity response is too large.",
          "jskit_preview_identity_response_too_large",
          { statusCode: 502 }
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > PREVIEW_IDENTITY_RESPONSE_LIMIT_BYTES) {
      throw commandError(
        "JSKIT preview identity response is too large.",
        "jskit_preview_identity_response_too_large",
        { statusCode: 502 }
      );
    }
  }
  if (!text) {
    return null;
  }
  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function upstreamError(payload = {}, response = {}, extra = {}) {
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
      "JSKIT preview identity exchange failed."
    ),
    String(firstError?.code || payload?.code || "jskit_preview_identity_upstream_rejected"),
    {
      ...extra,
      statusCode: Number(response.status || 502)
    }
  );
}

async function request(fetchImpl, href, options) {
  try {
    return await fetchImpl(href, options);
  } catch {
    throw commandError(
      "JSKIT preview identity could not reach the application.",
      "jskit_preview_identity_unreachable",
      { statusCode: 502 }
    );
  }
}

function postJson(fetchImpl, href, body, headers = {}) {
  return request(fetchImpl, href, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...headers
    },
    method: "POST",
    redirect: "manual"
  });
}

async function readSession(fetchImpl, targetOrigin) {
  const response = await request(fetchImpl, `${targetOrigin}${AUTH_PATHS.session}`, {
    method: "GET",
    redirect: "manual"
  });
  const payload = await responsePayload(response);
  const responseCookies = responseSetCookie(response);
  if (!response.ok) {
    throw upstreamError(payload, response, {
      setCookie: responseCookies,
      signedOut: false
    });
  }
  const csrfToken = String(payload?.csrfToken || "").trim();
  if (!csrfToken) {
    throw commandError(
      "JSKIT session bootstrap did not return a CSRF token.",
      "jskit_preview_identity_csrf_missing",
      {
        setCookie: responseCookies,
        statusCode: 502
      }
    );
  }
  return {
    csrfToken,
    setCookie: responseCookies
  };
}

async function logout(fetchImpl, targetOrigin, session) {
  const response = await postJson(fetchImpl, `${targetOrigin}${AUTH_PATHS.logout}`, {}, {
    cookie: cookieHeader(session.setCookie),
    "csrf-token": session.csrfToken
  });
  const payload = await responsePayload(response);
  const setCookie = [...session.setCookie, ...responseSetCookie(response)];
  if (!response.ok || payload?.ok !== true) {
    throw upstreamError(payload, response, {
      setCookie,
      signedOut: false
    });
  }
  return {
    csrfToken: session.csrfToken,
    setCookie
  };
}

async function login(fetchImpl, targetOrigin, identity, secret, session) {
  const loginResponse = await postJson(fetchImpl, `${targetOrigin}${AUTH_PATHS.devLoginAs}`, identity, {
    cookie: cookieHeader(session.setCookie),
    "csrf-token": session.csrfToken,
    [DEV_AUTH_SECRET_HEADER]: secret
  });
  const loginPayload = await responsePayload(loginResponse);
  const loginSetCookie = responseSetCookie(loginResponse);
  const setCookie = [...session.setCookie, ...loginSetCookie];
  if (!loginResponse.ok || loginPayload?.ok !== true) {
    throw upstreamError(loginPayload, loginResponse, {
      setCookie,
      signedOut: true
    });
  }
  return {
    identity: {
      displayName: String(loginPayload.displayName || loginPayload.username || "").trim(),
      email: String(loginPayload.email || identity.email || "").trim().toLowerCase(),
      userId: String(loginPayload.userId || identity.userId || "").trim(),
      username: String(loginPayload.username || "").trim()
    },
    setCookie
  };
}

async function executeJskitPreviewIdentityRequest(value = {}, {
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  let requestId = String(value?.requestId || "").trim();
  try {
    const request = normalizeRequest(value);
    requestId = request.requestId;
    if (typeof fetchImpl !== "function") {
      throw commandError(
        "JSKIT preview identity requires fetch support.",
        "jskit_preview_identity_fetch_unavailable",
        { statusCode: 500 }
      );
    }
    if (String(env[PREVIEW_IDENTITY_ENABLED_ENV] || "").trim().toLowerCase() !== "true") {
      throw commandError(
        "JSKIT development identity exchange is not enabled.",
        "jskit_preview_identity_disabled",
        { statusCode: 403 }
      );
    }
    const secret = String(env[PREVIEW_IDENTITY_SECRET_ENV] || "").trim();
    if (!/^[a-f0-9]{64}$/u.test(secret)) {
      throw commandError(
        "JSKIT development identity exchange secret is unavailable.",
        "jskit_preview_identity_secret_missing",
        { statusCode: 500 }
      );
    }
    const identity = request.operation === PREVIEW_IDENTITY_LOGIN_OPERATION
      ? identityFromSubject(request.subject)
      : null;
    const session = await readSession(fetchImpl, request.targetOrigin);
    const signedOutSession = await logout(fetchImpl, request.targetOrigin, session);
    if (request.operation === PREVIEW_IDENTITY_LOGOUT_OPERATION) {
      return previewIdentityResponse(requestId, {
        identity: null,
        ok: true,
        setCookie: signedOutSession.setCookie,
        signedOut: true
      });
    }
    const result = await login(
      fetchImpl,
      request.targetOrigin,
      identity,
      secret,
      signedOutSession
    );
    return previewIdentityResponse(requestId, {
      identity: result.identity,
      ok: true,
      setCookie: result.setCookie,
      signedOut: false
    });
  } catch (error) {
    return previewIdentityFailure(requestId, error);
  }
}

async function runAppPreviewIdentityCommand(_ctx = {}, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdin = process.stdin,
  stdout = process.stdout
} = {}) {
  let request;
  try {
    request = await readInput(stdin);
  } catch (error) {
    stdout.write(`${JSON.stringify(previewIdentityFailure("", error))}\n`);
    return 0;
  }
  const response = await executeJskitPreviewIdentityRequest(request, {
    env,
    fetchImpl
  });
  stdout.write(`${JSON.stringify(response)}\n`);
  return 0;
}

export {
  PREVIEW_IDENTITY_PROTOCOL,
  executeJskitPreviewIdentityRequest,
  runAppPreviewIdentityCommand
};
