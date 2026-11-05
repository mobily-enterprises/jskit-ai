import Provider, { interactionPolicy } from "oidc-provider";
import { isLoopbackHostname } from "./config.js";
import { deriveKey } from "./crypto.js";
import { escapeHtml, hubPage } from "./http.js";

const ACTIVE_STATUSES = new Set(["active", "active-dev"]);
const HUB_SCOPES = "openid email profile";
const ROUTES = Object.freeze({
  authorization: "/oidc/auth",
  backchannel_authentication: "/oidc/backchannel",
  code_verification: "/oidc/device",
  challenge: "/oidc/challenge",
  device_authorization: "/oidc/device/auth",
  end_session: "/oidc/session/end",
  introspection: "/oidc/token/introspection",
  jwks: "/oidc/jwks",
  pushed_authorization_request: "/oidc/request",
  registration: "/oidc/reg",
  revocation: "/oidc/token/revocation",
  token: "/oidc/token",
  userinfo: "/oidc/me",
  credential: "/oidc/credential"
});

function interactionPath(uid) {
  return `/hub/interaction/${uid}`;
}

/**
 * The language of a page oidc-provider renders: the request's ui_locales, then
 * the browser's Accept-Language, then English.
 * @param {import("./types.js").HubTexts} texts
 * @param {any} ctx oidc-provider's request context.
 */
function pageText(texts, ctx) {
  const lang = texts.localeFor({
    uiLocales: ctx.oidc?.params?.ui_locales ?? ctx.query?.ui_locales,
    acceptLanguage: ctx.headers?.["accept-language"]
  });
  return { lang, t: (key) => texts.t(lang, key) };
}

/**
 * The hub's own session is the single sign-in state: oidc-provider's session
 * only counts while this browser is still signed in to the hub as the same
 * person. Signing out of the hub, or ending this device's session from the
 * Account page, therefore also ends silent sign-in to apps.
 */
function interactionsPolicy(hasHubSession) {
  const policy = interactionPolicy.base();
  policy.get("login").checks.add(new interactionPolicy.Check(
    "hub_session",
    "The person is no longer signed in to the hub",
    "login_required",
    async (ctx) => {
      const { accountId } = ctx.oidc.session;
      if (!accountId) return interactionPolicy.Check.NO_NEED_TO_PROMPT;
      return (await hasHubSession(ctx, accountId))
        ? interactionPolicy.Check.NO_NEED_TO_PROMPT
        : interactionPolicy.Check.REQUEST_PROMPT;
    }
  ));
  return policy;
}

/**
 * Builds the hardened oidc-provider instance. Apps get the authorization code
 * flow with PKCE only, no refresh tokens, exact redirect URIs and a public
 * `sub`. A grant exists only for clients the registration policy marked
 * active: a pending app always reaches the hub's waiting page.
 * @param {object} dependencies
 * @param {import("./types.js").HubConfig} dependencies.config
 * @param {{ keys: object[] }} dependencies.jwks The hub's public signing keys.
 * @param {import("./types.js").HubAdapterClass} dependencies.Adapter
 * @param {ReturnType<typeof import("./accounts.js").createAccountStore>} dependencies.accounts
 * @param {ReturnType<typeof import("./clients.js").createClientStore>} dependencies.clients
 * @param {(ctx: any, accountId: string) => Promise<boolean>} dependencies.hasHubSession
 *   Answers whether the browser still has the hub session of the account.
 * @param {import("./types.js").HubTexts} dependencies.texts The hub's pages in a person's language.
 */
function createOidcProvider({ config, jwks, Adapter, accounts, clients, hasHubSession, texts }) {
  const provider = new Provider(config.issuer, {
    adapter: Adapter,
    jwks,
    cookies: {
      keys: [deriveKey(config.secret, "cookies").toString("base64url")],
      long: { sameSite: "lax" },
      short: { sameSite: "lax" }
    },
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name"]
    },
    scopes: HUB_SCOPES.split(" "),
    responseTypes: ["code"],
    // Apps read email and name straight from the ID token.
    conformIdTokenClaims: false,
    clientDefaults: {
      grant_types: ["authorization_code"],
      id_token_signed_response_alg: "ES256",
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic"
    },
    enabledJWA: {
      idTokenSigningAlgValues: ["ES256"],
      userinfoSigningAlgValues: ["ES256"]
    },
    pkce: { required: () => true },
    routes: ROUTES,
    features: {
      devInteractions: { enabled: false },
      registration: {
        enabled: true,
        initialAccessToken: config.registrationToken,
        idFactory: (ctx) => ctx.req.hubClientId,
        issueRegistrationAccessToken: true
      },
      registrationManagement: { enabled: true, rotateRegistrationAccessToken: false },
      rpInitiatedLogout: {
        enabled: true,
        async logoutSource(ctx, form) {
          const { lang, t } = pageText(texts, ctx);
          const confirm = escapeHtml(t("jskit.accounts.page.signOut.confirm"));
          const stay = escapeHtml(t("jskit.accounts.page.signOut.stay"));
          ctx.type = "html";
          ctx.body = hubPage({
            lang,
            title: t("jskit.accounts.page.signOut.title"),
            heading: t("jskit.accounts.page.signOut.heading"),
            body: t("jskit.accounts.page.signOut.body"),
            content: `${form}<div class="actions"><button class="primary" autofocus type="submit" form="op.logoutForm" value="yes" name="logout">${confirm}</button><button class="secondary" type="submit" form="op.logoutForm">${stay}</button></div>`
          });
        },
        async postLogoutSuccessSource(ctx) {
          const { lang, t } = pageText(texts, ctx);
          ctx.type = "html";
          ctx.body = hubPage({
            lang,
            title: t("jskit.accounts.page.signedOut.title"),
            heading: t("jskit.accounts.page.signedOut.heading"),
            body: t("jskit.accounts.page.signedOut.body")
          });
        }
      },
      backchannelLogout: { enabled: true },
      clientCredentials: { enabled: false },
      introspection: { enabled: false },
      revocation: { enabled: false }
    },
    issueRefreshToken: () => false,
    // Outgoing calls (back-channel logout) keep oidc-provider's protection
    // against private addresses, except a development hub calling an app on
    // this same computer.
    fetch(url, options) {
      if (!config.isProduction && isLoopbackHostname(new URL(url).hostname)) {
        const { dispatcher: _dispatcher, ...direct } = options;
        return globalThis.fetch(url, direct);
      }
      return globalThis.fetch(url, options);
    },
    interactions: {
      policy: interactionsPolicy(hasHubSession),
      url: (_ctx, interaction) => interactionPath(interaction.uid)
    },
    async findAccount(_ctx, sub) {
      const account = await accounts.findById(sub);
      if (!account || account.disabled) return undefined;
      return {
        accountId: account.id,
        async claims() {
          return {
            sub: account.id,
            email: account.email,
            email_verified: account.emailVerified,
            name: account.displayName
          };
        }
      };
    },
    async loadExistingGrant(ctx) {
      const { client, session } = ctx.oidc;
      const row = await clients.get(client.clientId);
      if (!row || !ACTIVE_STATUSES.has(row.status)) return undefined;
      await clients.touch(client.clientId);
      const grantId = session.grantIdFor(client.clientId);
      const existing = grantId ? await ctx.oidc.provider.Grant.find(grantId) : undefined;
      if (existing && existing.accountId === session.accountId) return existing;
      const grant = new ctx.oidc.provider.Grant({ clientId: client.clientId, accountId: session.accountId });
      grant.addOIDCScope(HUB_SCOPES);
      await grant.save();
      return grant;
    },
    async renderError(ctx, out) {
      const { lang, t } = pageText(texts, ctx);
      ctx.type = "html";
      ctx.body = hubPage({
        lang,
        title: t("jskit.accounts.page.error.title"),
        heading: t("jskit.accounts.page.error.heading"),
        // oidc-provider's own description of the protocol error stays as it wrote it.
        body: out.error_description || t("jskit.accounts.page.error.body")
      });
    }
  });
  provider.proxy = true;
  return provider;
}

export { ACTIVE_STATUSES, HUB_SCOPES, createOidcProvider };
