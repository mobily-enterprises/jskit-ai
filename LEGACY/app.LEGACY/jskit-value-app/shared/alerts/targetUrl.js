const ALERT_TARGET_URL_ERRORS = Object.freeze({
  required: "targetUrl is required.",
  startsWithSlash: "targetUrl must start with /.",
  inAppPath: "targetUrl must be an in-app path."
});

function normalizeText(value) {
  return String(value || "").trim();
}

function evaluateAlertTargetUrl(value, { required = true } = {}) {
  const targetUrl = normalizeText(value);
  if (!targetUrl) {
    return {
      targetUrl,
      error: required ? ALERT_TARGET_URL_ERRORS.required : null
    };
  }

  if (!targetUrl.startsWith("/")) {
    return {
      targetUrl,
      error: ALERT_TARGET_URL_ERRORS.startsWithSlash
    };
  }

  const lowerTargetUrl = targetUrl.toLowerCase();
  if (
    lowerTargetUrl.startsWith("http://") ||
    lowerTargetUrl.startsWith("https://") ||
    lowerTargetUrl.startsWith("//")
  ) {
    return {
      targetUrl,
      error: ALERT_TARGET_URL_ERRORS.inAppPath
    };
  }

  return {
    targetUrl,
    error: null
  };
}

function normalizeAlertTargetUrl(value, options = {}) {
  const { targetUrl, error } = evaluateAlertTargetUrl(value, options);
  return error ? "" : targetUrl;
}

export { ALERT_TARGET_URL_ERRORS, evaluateAlertTargetUrl, normalizeAlertTargetUrl };
