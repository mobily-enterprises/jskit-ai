import Provider from "oidc-provider";
import { isLoopbackHostname } from "./config.js";
import { deriveKey } from "./crypto.js";
import { hubPage } from "./http.js";

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
 * Builds the hardened oidc-provider instance. Apps get the authorization code
 * flow with PKCE only, no refresh tokens, exact redirect URIs and a public
 * `sub`. A grant exists only for clients the registration policy marked
 * active: a pending app always reaches the hub's waiting page.
 */
function createOidcProvider({ config, jwks, Adapter, accounts, clients, onEndSession }) {
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
          ctx.type = "html";
          ctx.body = hubPage({
            title: "Sign out",
            heading: "Sign out of your apps?",
            body: "You will need to sign in again the next time you open one of them.",
            content: `${form}<div class="actions"><button class="primary" autofocus type="submit" form="op.logoutForm" value="yes" name="logout">Sign out</button><button class="secondary" type="submit" form="op.logoutForm">Stay signed in</button></div>`
          });
        },
        async postLogoutSuccessSource(ctx) {
          ctx.type = "html";
          ctx.body = hubPage({
            title: "Signed out",
            heading: "You are signed out.",
            body: "You can close this window."
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
      ctx.type = "html";
      ctx.body = hubPage({
        title: "Sign-in problem",
        heading: "This sign-in could not continue.",
        body: out.error_description || "Go back to the app and try again."
      });
    }
  });
  provider.proxy = true;
  provider.on("end_session.success", (ctx) => onEndSession?.(ctx));
  return provider;
}

export { ACTIVE_STATUSES, HUB_SCOPES, createOidcProvider };
