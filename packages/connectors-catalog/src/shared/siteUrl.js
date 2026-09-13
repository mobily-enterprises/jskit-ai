function validSiteUrl(value) {
  if (!/^https:\/\//iu.test(value) || /[\s\\?#]/u.test(value) || /\/(?:\.|%2e){1,2}(?:\/|$)/iu.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

const httpsSiteUrlField = { type: "string", required: true, minLength: 1, maxLength: 2048,
  validator: (value) => validSiteUrl(value) || "Use an HTTPS site URL without credentials, a query, fragment or parent-path segments." };

export { httpsSiteUrlField };
