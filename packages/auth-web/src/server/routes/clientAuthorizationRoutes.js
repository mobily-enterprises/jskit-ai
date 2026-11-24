import { ClientAuthorizationError } from "@jskit-ai/auth-core/server/clientAuthorizationError";
import { createServerI18n } from "@jskit-ai/kernel/server/i18n";
import en from "../../../locales/en.json" with { type: "json" };

// The authorization server of an auth provider that has OAuth clients (config.auth.clients): its metadata, the consent
// page people allow a client on, and the token and revocation endpoints the client calls. They are Fastify routes of
// their own scope, as pass sign-in's is, for the form bodies OAuth posts; none takes a CSRF token: the consent page's
// form carries a ticket signed for the session that saw it, and the endpoints sign in by the client's own credentials.

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const MAX_FORM_BYTES = 8 * 1024;
const METADATA_PATH = "/.well-known/oauth-authorization-server";
const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/api/oauth/token";
const REVOKE_PATH = "/api/oauth/revoke";
const LOGIN_PATH = "/auth/login";
const PUBLIC_ROUTE = Object.freeze({ authPolicy: "public", csrfProtection: false });
const TEXTS = "jskit.auth.clientConsent";

function parseForm(_request, body, done) {
  done(null, Object.fromEntries(new URLSearchParams(String(body || ""))));
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);

/** The person's preferred languages, most preferred first, from Accept-Language. */
function preferredLocales(request) {
  return String(request.headers["accept-language"] || "").split(",")
    .map((entry) => entry.split(";")[0].trim()).filter(Boolean);
}

const PAGE_STYLE = `
:root { color-scheme: light dark; --page: #f6f6f8; --card: #ffffff; --text: #1b1b1f; --muted: #5d5e66; --accent: #3557c5; --on-accent: #ffffff; --line: #d9d9e0; }
@media (prefers-color-scheme: dark) { :root { --page: #121316; --card: #1d1e22; --text: #e4e2e6; --muted: #a9aab2; --accent: #b3c5ff; --on-accent: #10296e; --line: #3a3b41; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--page); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
main { width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 28px 24px; }
h1 { font-size: 1.375rem; line-height: 1.3; margin: 0 0 12px; }
p { margin: 0 0 12px; }
.muted { color: var(--muted); }
form { display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end; margin-top: 24px; }
button { font: inherit; font-weight: 600; min-height: 44px; padding: 0 20px; border-radius: 22px; border: 1px solid var(--line); background: transparent; color: var(--accent); cursor: pointer; }
button.allow { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }`;

function page({ locale, title, body }) {
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/**
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} fastify
 * @param {object} dependencies
 * @param {import("../services/AuthWebService.js").AuthWebService} dependencies.service
 * @param {string} dependencies.appName The application's name (config.app.name), as the consent page names it; ""
 *   names it "this app".
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot | null} dependencies.appRoot Where the app's
 *   translations are; English alone without it.
 * @param {{ max: number, timeWindow: string | number } | null} dependencies.rateLimit The `clientToken` auth rate limit.
 */
async function registerClientAuthorizationRoutes(fastify, { service, appName, appRoot, rateLimit }) {
  const metadata = service.clientAuthorizationMetadata();
  if (!metadata) return;
  if (rateLimit && !fastify.hasDecorator("rateLimit")) {
    throw new Error("config.auth.rateLimits.clientToken limits OAuth clients' token requests, and no route rate limiter is registered because no other route has a limit. Give another auth route a limit, or set config.auth.rateLimits.clientToken to false.");
  }
  const i18n = createServerI18n({ appRoot: appRoot || "", catalogs: [en] });

  function render(request, reply, { status = 200, view, client = "", formAction = "" }) {
    const locale = i18n.resolveLocale(preferredLocales(request));
    const app = appName || i18n.t(locale, `${TEXTS}.thisApp`);
    const t = (key, params = {}) => i18n.t(locale, `${TEXTS}.${key}`, { app, client, ...params });
    // The page is never framed, runs no script, and its form goes to this server, whose answer goes to the client.
    reply.code(status)
      .header("cache-control", "no-store")
      .header("x-frame-options", "DENY")
      .header("content-security-policy", `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'${formAction ? ` ${formAction}` : ""}`)
      .header("content-type", "text/html; charset=utf-8");
    if (view.kind === "refused") {
      return reply.send(page({
        locale,
        title: t("refusedTitle"),
        body: `<h1>${escapeHtml(t("refusedTitle"))}</h1>\n<p>${escapeHtml(t(`refused.${view.reason}`))}</p>`
      }));
    }
    return reply.send(page({
      locale,
      title: t("title"),
      body: [
        `<h1>${escapeHtml(t("heading"))}</h1>`,
        `<p class="muted">${escapeHtml(t("signedInAs", { email: view.person.email }))}</p>`,
        `<p>${escapeHtml(t("rights"))}</p>`,
        `<p class="muted">${escapeHtml(t("disconnect"))}</p>`,
        `<form method="post" action="${AUTHORIZE_PATH}">`,
        `<input type="hidden" name="ticket" value="${escapeHtml(view.ticket)}">`,
        `<button type="submit" name="decision" value="deny">${escapeHtml(t("deny"))}</button>`,
        `<button type="submit" name="decision" value="allow" class="allow">${escapeHtml(t("allow"))}</button>`,
        "</form>"
      ].join("\n")
    }));
  }

  function answer(request, reply, outcome) {
    if (outcome.kind === "redirect") return reply.header("cache-control", "no-store").redirect(outcome.to, 303);
    if (outcome.kind === "sign-in") {
      return reply.redirect(`${LOGIN_PATH}?${new URLSearchParams({ returnTo: request.url })}`, 303);
    }
    return render(request, reply, {
      status: outcome.kind === "refused" ? 400 : 200,
      view: outcome,
      client: outcome.client?.name || "",
      formAction: outcome.returnsTo || ""
    });
  }

  /** A protocol endpoint's answer: its result as JSON, or its refusal as RFC 6749 section 5.2 says. */
  async function protocolAnswer(reply, work) {
    reply.header("cache-control", "no-store").header("pragma", "no-cache");
    try {
      const result = await work();
      return result === undefined ? reply.code(200).send() : reply.send(result);
    } catch (error) {
      if (!(error instanceof ClientAuthorizationError)) throw error;
      return reply.code(error.status).send({ error: error.error, error_description: error.message });
    }
  }

  await fastify.register(async (scope) => {
    scope.addContentTypeParser(FORM_CONTENT_TYPE, { parseAs: "string", bodyLimit: MAX_FORM_BYTES }, parseForm);
    const limited = { config: { ...PUBLIC_ROUTE, ...(rateLimit ? { rateLimit } : {}) } };
    scope.get(METADATA_PATH, { config: PUBLIC_ROUTE }, async (_request, reply) => reply.header("cache-control", "max-age=300").send(metadata));
    scope.get(AUTHORIZE_PATH, limited, async (request, reply) =>
      answer(request, reply, await service.startClientAuthorization(request.query || {}, request)));
    scope.post(AUTHORIZE_PATH, limited, async (request, reply) => {
      const form = /** @type {Record<string, string>} */ (request.body || {});
      return answer(request, reply, await service.decideClientAuthorization({ ticket: form.ticket, allow: form.decision === "allow" }, request));
    });
    scope.post(TOKEN_PATH, limited, async (request, reply) =>
      protocolAnswer(reply, () => service.exchangeClientToken(request.body || {}, request)));
    scope.post(REVOKE_PATH, limited, async (request, reply) =>
      protocolAnswer(reply, () => service.revokeClientToken(request.body || {})));
  });
}

export { registerClientAuthorizationRoutes };
