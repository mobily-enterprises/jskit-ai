export function readOtpLoginCallbackStateFromLocation() {
  if (typeof window === "undefined") {
    return null;
  }

  const search = new URLSearchParams(window.location.search || "");
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const tokenHash = String(search.get("token_hash") || hash.get("token_hash") || "").trim();
  const type = String(search.get("type") || hash.get("type") || "")
    .trim()
    .toLowerCase();
  const errorCode = String(search.get("error") || hash.get("error") || "").trim();
  const errorDescription = String(search.get("error_description") || hash.get("error_description") || "").trim();
  const hasOtpHint = Boolean(tokenHash) || type === "email";

  if (!hasOtpHint || (!tokenHash && !errorCode)) {
    return null;
  }

  return {
    tokenHash,
    type: type || "email",
    errorCode,
    errorDescription
  };
}

export function stripOtpLoginCallbackParamsFromLocation() {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const search = new URLSearchParams(url.search);
  const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));

  const keysToStrip = ["token_hash", "type", "error", "error_description", "expires_at", "expires_in", "token"];
  for (const key of keysToStrip) {
    search.delete(key);
    hash.delete(key);
  }

  const nextSearch = search.toString();
  const nextHash = hash.toString();
  const nextPath = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, "", nextPath || "/");
}
