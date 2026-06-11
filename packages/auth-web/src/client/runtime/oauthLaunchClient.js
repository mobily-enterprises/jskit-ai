function createBrowserOAuthLaunchClient({ location = null } = {}) {
  const resolvedLocation =
    location || (typeof window === "object" && window?.location ? window.location : null);

  return Object.freeze({
    async open({ url = "" } = {}) {
      const normalizedUrl = String(url || "").trim();
      if (!normalizedUrl) {
        throw new Error("OAuth launch URL is required.");
      }
      if (!resolvedLocation || typeof resolvedLocation.assign !== "function") {
        throw new Error("Browser location.assign() is unavailable for OAuth launch.");
      }

      resolvedLocation.assign(normalizedUrl);
      return true;
    }
  });
}

function isAuthOAuthLaunchClient(value = null) {
  return Boolean(value && typeof value === "object" && typeof value.open === "function");
}

export {
  createBrowserOAuthLaunchClient,
  isAuthOAuthLaunchClient
};
