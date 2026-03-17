function toQueryErrorMessage(error, fallbackMessage = "", defaultMessage = "Request failed.") {
  if (!error) {
    return "";
  }

  return String(error?.message || fallbackMessage || defaultMessage).trim();
}

function toUiErrorMessage(error, fallbackMessage = "", defaultMessage = "Request failed.") {
  const normalizedFallback = String(fallbackMessage || "").trim();
  if (normalizedFallback) {
    return normalizedFallback;
  }

  const normalizedMessage = String(error?.message || "").trim();
  if (normalizedMessage) {
    return normalizedMessage;
  }

  return String(defaultMessage || "Request failed.").trim();
}

export {
  toQueryErrorMessage,
  toUiErrorMessage
};
