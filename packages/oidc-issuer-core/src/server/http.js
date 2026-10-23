/** Small HTTP helpers shared by the hub's Fastify routes. */

class HubError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!(name in cookies)) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function serializeCookie(name, value, { maxAge, secure, path = "/", httpOnly = true, sameSite = "Lax" }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join("; ");
}

function appendCookie(reply, cookie) {
  const existing = reply.getHeader("set-cookie");
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  reply.header("set-cookie", [...list, cookie]);
}

function clientIp(request) {
  return String(request.ip || request.socket?.remoteAddress || "unknown");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[char]);
}

/**
 * A calm standalone page for the few screens oidc-provider renders itself
 * (errors and the sign-out confirmation). It follows the light or dark
 * preference of the device.
 */
function hubPage({ title, heading, body, content = "" }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f4f5fb;--card:#fff;--text:#1b1c22;--muted:#5d5f6a;--primary:#315da8;--on-primary:#fff;--line:#e2e3ec}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1b1d24;--text:#e3e3ea;--muted:#a6a8b5;--primary:#a9c7ff;--on-primary:#0b2a5c;--line:#2c2f39}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:32px}
.mark{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--primary) 16%,transparent);color:var(--primary);margin-bottom:20px}
h1{font-size:22px;line-height:1.3;margin:0 0 8px;font-weight:600}p{margin:0 0 24px;color:var(--muted)}
.actions{display:flex;gap:12px;flex-wrap:wrap}button,a.button{appearance:none;border:0;border-radius:999px;padding:10px 20px;font:600 15px/1.2 inherit;cursor:pointer;text-decoration:none;display:inline-block}
.primary{background:var(--primary);color:var(--on-primary)}.secondary{background:transparent;color:var(--primary);border:1px solid var(--line)}
button:focus-visible,a:focus-visible{outline:3px solid color-mix(in srgb,var(--primary) 40%,transparent);outline-offset:2px}
</style></head><body><main>
<div class="mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 14.2c-2.5-.8-4.62-2.65-5.83-5.02C7.4 14.9 10.1 14.4 12 14.4s4.6.5 5.83 1.78A10.13 10.13 0 0 1 12 21.2Z"/></svg></div>
<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(body)}</p>${content}
</main></body></html>`;
}

export { HubError, appendCookie, clientIp, escapeHtml, hubPage, parseCookies, serializeCookie };
