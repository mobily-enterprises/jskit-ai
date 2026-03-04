const DEFAULT_DOMAIN_ERROR_STATUS_BY_CODE = Object.freeze({
  domain_validation_failed: 422,
  validation_failed: 422,
  invalid_input: 422,
  duplicate: 409,
  duplicate_contact: 409,
  conflict: 409,
  not_found: 404,
  forbidden: 403,
  unauthorized: 401,
  rate_limited: 429
});

function normalizeStatus(status, fallbackStatus) {
  const numeric = Number(status);
  if (Number.isInteger(numeric) && numeric >= 100 && numeric <= 599) {
    return numeric;
  }

  const fallbackNumeric = Number(fallbackStatus);
  if (Number.isInteger(fallbackNumeric) && fallbackNumeric >= 100 && fallbackNumeric <= 599) {
    return fallbackNumeric;
  }

  return 500;
}

function normalizeCode(code) {
  const normalized = String(code || "")
    .trim()
    .toLowerCase();
  return normalized || "";
}

function resolveDomainErrorStatus({
  status,
  code,
  domainErrorStatusByCode = DEFAULT_DOMAIN_ERROR_STATUS_BY_CODE,
  fallbackStatus = 422
} = {}) {
  const explicitStatus = Number(status);
  if (Number.isInteger(explicitStatus) && explicitStatus >= 100 && explicitStatus <= 599) {
    return explicitStatus;
  }

  const normalizedCode = normalizeCode(code);
  if (normalizedCode) {
    const mapSource =
      domainErrorStatusByCode && typeof domainErrorStatusByCode === "object"
        ? domainErrorStatusByCode
        : DEFAULT_DOMAIN_ERROR_STATUS_BY_CODE;
    const mappedStatus = Number(mapSource[normalizedCode]);
    if (Number.isInteger(mappedStatus) && mappedStatus >= 100 && mappedStatus <= 599) {
      return mappedStatus;
    }
  }

  return normalizeStatus(fallbackStatus, 422);
}

function ensureReply(reply, methodName) {
  if (!reply || typeof reply.code !== "function" || typeof reply.send !== "function") {
    throw new TypeError(`${methodName} requires a Fastify reply-like object with code() and send().`);
  }
}

function applyHeaders(reply, headers) {
  if (!headers || typeof headers !== "object" || typeof reply.header !== "function") {
    return;
  }

  for (const [name, value] of Object.entries(headers)) {
    reply.header(name, value);
  }
}

class BaseController {
  constructor({ domainErrorStatusByCode = DEFAULT_DOMAIN_ERROR_STATUS_BY_CODE } = {}) {
    this.domainErrorStatusByCode =
      domainErrorStatusByCode && typeof domainErrorStatusByCode === "object"
        ? { ...DEFAULT_DOMAIN_ERROR_STATUS_BY_CODE, ...domainErrorStatusByCode }
        : { ...DEFAULT_DOMAIN_ERROR_STATUS_BY_CODE };
  }

  ok(reply, payload, { status = 200, headers = null } = {}) {
    ensureReply(reply, "BaseController.ok");
    applyHeaders(reply, headers);

    const normalizedStatus = normalizeStatus(status, 200);
    reply.code(normalizedStatus);

    if (normalizedStatus === 204) {
      return reply.send();
    }

    return reply.send(payload);
  }

  created(reply, payload, { headers = null } = {}) {
    return this.ok(reply, payload, {
      status: 201,
      headers
    });
  }

  noContent(reply, { headers = null } = {}) {
    return this.ok(reply, undefined, {
      status: 204,
      headers
    });
  }

  fail(
    reply,
    { status, code, message = "Request failed.", details, fieldErrors, headers = null, fallbackStatus = 422 } = {}
  ) {
    ensureReply(reply, "BaseController.fail");

    const resolvedStatus = resolveDomainErrorStatus({
      status,
      code,
      domainErrorStatusByCode: this.domainErrorStatusByCode,
      fallbackStatus
    });

    const payload = {
      error: String(message || "Request failed.")
    };

    const normalizedCode = normalizeCode(code);
    if (normalizedCode) {
      payload.code = String(code || "").trim();
    }

    if (details !== undefined) {
      payload.details = details;
    }

    if (fieldErrors !== undefined) {
      payload.fieldErrors = fieldErrors;
      if (payload.details === undefined) {
        payload.details = { fieldErrors };
      }
    }

    applyHeaders(reply, headers);
    reply.code(resolvedStatus);
    return reply.send(payload);
  }

  sendActionResult(
    reply,
    result,
    { successStatus = 200, defaultErrorStatus = 422, defaultErrorMessage = "Request failed." } = {}
  ) {
    if (!result || typeof result !== "object") {
      throw new TypeError("BaseController.sendActionResult requires an object result.");
    }

    if (result.ok === true) {
      const payload = Object.prototype.hasOwnProperty.call(result, "data") ? result.data : undefined;
      return this.ok(reply, payload, {
        status: result.status ?? successStatus,
        headers: result.headers
      });
    }

    if (result.ok === false) {
      return this.fail(reply, {
        status: result.status,
        code: result.code,
        message: result.message || defaultErrorMessage,
        details: result.details,
        fieldErrors: result.fieldErrors,
        headers: result.headers,
        fallbackStatus: defaultErrorStatus
      });
    }

    throw new TypeError("BaseController.sendActionResult expects result.ok to be true or false.");
  }
}

export { BaseController, DEFAULT_DOMAIN_ERROR_STATUS_BY_CODE, resolveDomainErrorStatus };
