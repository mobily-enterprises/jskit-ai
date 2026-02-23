export function hasRecoveryLinkPayload() {
  if (typeof window === "undefined") {
    return false;
  }

  const search = new URLSearchParams(window.location.search || "");
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const type = String(search.get("type") || hash.get("type") || "")
    .trim()
    .toLowerCase();

  return type === "recovery";
}
