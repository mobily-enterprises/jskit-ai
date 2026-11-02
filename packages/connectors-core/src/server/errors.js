// code is the stable value callers branch on, and many sentences share one code,
// so each sentence also has a messageCode (with messageParams) that renders it from
// the "jskit.<messageCode>" catalog entry; message stays that English text.
class ConnectorError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   * @param {number} [details.statusCode]
   * @param {number} [details.retryAfterSeconds]
   * @param {string} [details.messageCode]
   * @param {Record<string, unknown>} [details.messageParams]
   */
  constructor(code, message, { statusCode = 400, retryAfterSeconds, messageCode, messageParams } = {}) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.statusCode = statusCode;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
    if (messageCode) {
      this.messageCode = messageCode;
      this.messageParams = { ...messageParams };
    }
  }
}

/**
 * The refusal for a provider's failed HTTP response, by its status, without the
 * provider's own text: what a provider's exchange() throws for a response it
 * does not map itself.
 * @param {number} status
 */
function providerStatusError(status) {
  if (status === 401) {
    return new ConnectorError("connector_reconnect_required", "Connect this account again.", { statusCode: 401, messageCode: "connectors.connection.connectAccountAgain" });
  }
  if (status === 403) return new ConnectorError("connector_permission_denied", "The provider denied this operation.", { statusCode: 403, messageCode: "connectors.connection.providerDeniedOperation" });
  if (status === 429) return new ConnectorError("connector_rate_limited", "The provider's request limit was reached.", { statusCode: 429, messageCode: "connectors.connection.providerRequestLimitReached" });
  return new ConnectorError("connector_provider_failed", "The provider request failed. Try again.", { statusCode: 502, messageCode: "connectors.connection.providerRequestFailedTryAgain" });
}

function providerError(error) {
  if (error instanceof ConnectorError) return error;
  const status = Number(error?.status || error?.statusCode || 0);
  if (error?.name === "AbortError") return new ConnectorError("connector_cancelled", "The operation was cancelled.", { messageCode: "connectors.connection.operationCancelled" });
  if (error?.name === "TimeoutError") return new ConnectorError("connector_provider_timeout", "The provider request timed out. Try again.", { statusCode: 504 });
  if (["invalid_grant", "invalid_client"].includes(error?.error) || status === 401) return providerStatusError(401);
  if (["access_denied", "user_cancelled_login", "user_cancelled_authorize"].includes(error?.error)) {
    return new ConnectorError("connector_consent_denied", "Account access was declined.");
  }
  return providerStatusError(status);
}

export { ConnectorError, providerError, providerStatusError };
