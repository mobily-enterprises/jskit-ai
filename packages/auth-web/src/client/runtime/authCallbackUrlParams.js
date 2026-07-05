const AUTH_CALLBACK_URL_BASE = "https://jskit.invalid";

function readAuthCallbackUrlParams(url = "") {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(normalizedUrl, AUTH_CALLBACK_URL_BASE);
    return {
      parsedUrl,
      searchParams: new URLSearchParams(parsedUrl.search || ""),
      hashParams: new URLSearchParams(String(parsedUrl.hash || "").replace(/^#/, ""))
    };
  } catch {
    return null;
  }
}

function readAuthCallbackParam(callbackUrlParams, key) {
  const normalizedKey = String(key || "").trim();
  if (!callbackUrlParams || !normalizedKey) {
    return "";
  }

  return String(
    callbackUrlParams.searchParams.get(normalizedKey) ||
      callbackUrlParams.hashParams.get(normalizedKey) ||
      ""
  ).trim();
}

function stripAuthCallbackParamsFromUrl(url = "", keys = []) {
  const callbackUrlParams = readAuthCallbackUrlParams(url);
  if (!callbackUrlParams) {
    return "";
  }

  const normalizedKeys = Array.isArray(keys)
    ? keys.map((key) => String(key || "").trim()).filter(Boolean)
    : [];
  normalizedKeys.forEach((key) => {
    callbackUrlParams.parsedUrl.searchParams.delete(key);
    callbackUrlParams.hashParams.delete(key);
  });

  const nextHash = callbackUrlParams.hashParams.toString();
  return `${callbackUrlParams.parsedUrl.pathname}${callbackUrlParams.parsedUrl.search}${nextHash ? `#${nextHash}` : ""}`;
}

export {
  readAuthCallbackParam,
  readAuthCallbackUrlParams,
  stripAuthCallbackParamsFromUrl
};
