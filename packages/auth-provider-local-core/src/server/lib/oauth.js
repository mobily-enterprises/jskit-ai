import * as client from "openid-client";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";

const OIDC_SCOPE = "openid email profile";
const GITHUB_SCOPE = "read:user user:email";
// Personal Microsoft accounts sign in through this tenant; their address is the account itself.
const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

// Google and Microsoft speak OpenID Connect (discovery from `issuer`); GitHub
// speaks plain OAuth 2.0 and its API names the person.
const OAUTH_PROVIDER_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "google", label: "Google", envPrefix: "AUTH_GOOGLE", issuer: "https://accounts.google.com" }),
  Object.freeze({
    id: "microsoft",
    label: "Microsoft",
    envPrefix: "AUTH_MICROSOFT",
    issuer: "https://login.microsoftonline.com/common/v2.0"
  }),
  Object.freeze({
    id: "github",
    label: "GitHub",
    envPrefix: "AUTH_GITHUB",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    apiUrl: "https://api.github.com"
  })
]);

/** The providers whose client id and secret are both set, in catalog order. */
function resolveOAuthProviders(env = {}) {
  const providers = [];
  for (const definition of OAUTH_PROVIDER_DEFINITIONS) {
    const clientId = String(env[`${definition.envPrefix}_CLIENT_ID`] || "").trim();
    const clientSecret = String(env[`${definition.envPrefix}_CLIENT_SECRET`] || "").trim();
    if (!clientId && !clientSecret) {
      continue;
    }
    if (!clientId || !clientSecret) {
      throw new Error(`${definition.envPrefix}_CLIENT_ID and ${definition.envPrefix}_CLIENT_SECRET must be set together.`);
    }
    providers.push(Object.freeze({ ...definition, clientId, clientSecret }));
  }
  return Object.freeze(providers);
}

// Errors that name a provider carry its label as the provider param.
function signInError(statusCode, message, { code, provider = null }) {
  return new AppError(statusCode, message, {
    code,
    ...(provider ? { params: { provider: provider.label } } : {})
  });
}

function unverifiedSignIn() {
  return signInError(401, "Your sign-in could not be verified. Start again.", { code: "auth.local.oauth.unverified" });
}

function displayNameFrom(source = {}) {
  return String(source.name || [source.given_name, source.family_name].filter(Boolean).join(" ") || "").trim();
}

// Each reader returns { subject, email, emailVerified, name } from what the provider vouches for.
const IDENTITY_READERS = Object.freeze({
  async google(configuration, tokens) {
    const claims = tokens.claims() || {};
    const source = claims.email || !tokens.access_token
      ? claims
      : await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);
    return { subject: claims.sub, email: source.email, emailVerified: source.email_verified === true, name: displayNameFrom(source) };
  },
  // A work or school account's email claim is whatever its tenant typed, so it
  // counts only when Microsoft verified the tenant's domain (xms_edov).
  async microsoft(_configuration, tokens) {
    const claims = tokens.claims() || {};
    return {
      subject: claims.sub,
      email: claims.email,
      emailVerified: claims.tid === MICROSOFT_CONSUMER_TENANT_ID || claims.xms_edov === true,
      name: displayNameFrom(claims)
    };
  },
  async github(configuration, tokens, provider) {
    async function read(path) {
      const response = await client.fetchProtectedResource(
        configuration,
        tokens.access_token,
        new URL(path, provider.apiUrl),
        "GET",
        undefined,
        new Headers({ accept: "application/vnd.github+json" })
      );
      if (!response.ok) {
        throw unverifiedSignIn();
      }
      return response.json();
    }
    const user = await read("/user");
    const emails = await read("/user/emails");
    const primary = (Array.isArray(emails) ? emails : []).find((entry) => entry?.primary === true);
    return {
      subject: user?.id == null ? "" : String(user.id),
      email: primary?.email,
      emailVerified: primary?.verified === true,
      name: String(user?.name || user?.login || "").trim()
    };
  }
});

/**
 * The authorization-code (PKCE) client for each configured provider. Provider
 * tokens are used once to learn who signed in and are never kept.
 */
function createOAuthClients({ logger = null } = {}) {
  const configurations = new Map();

  async function createConfiguration(provider) {
    const clientAuthentication = client.ClientSecretPost(provider.clientSecret);
    const address = new URL(provider.issuer || provider.authorizationEndpoint);
    // Real providers are https; only a local test provider is plain http.
    const insecure = address.protocol === "http:";
    if (!provider.issuer) {
      const configuration = new client.Configuration(
        {
          issuer: address.origin,
          authorization_endpoint: provider.authorizationEndpoint,
          token_endpoint: provider.tokenEndpoint
        },
        provider.clientId,
        undefined,
        clientAuthentication
      );
      if (insecure) client.allowInsecureRequests(configuration);
      return configuration;
    }
    const configuration = await client.discovery(
      address,
      provider.clientId,
      undefined,
      clientAuthentication,
      insecure ? { execute: [client.allowInsecureRequests] } : undefined
    );
    // Verify ID token signatures against the provider's published keys (JWKS).
    client.enableNonRepudiationChecks(configuration);
    return configuration;
  }

  async function configurationFor(provider) {
    if (!configurations.has(provider.id)) {
      configurations.set(provider.id, createConfiguration(provider).catch((error) => {
        configurations.delete(provider.id);
        logger?.warn?.({ err: error, provider: provider.id }, "OAuth provider discovery failed.");
        throw signInError(503, `${provider.label} can't be reached right now. Try again in a moment.`,
          { code: "auth.local.oauth.providerUnreachable", provider });
      }));
    }
    return configurations.get(provider.id);
  }

  async function authorizationUrl(provider, { redirectUri, state, nonce, codeVerifier }) {
    const configuration = await configurationFor(provider);
    return client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: provider.issuer ? OIDC_SCOPE : GITHUB_SCOPE,
      state,
      ...(provider.issuer ? { nonce } : {}),
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256"
    }).href;
  }

  /**
   * Exchanges the code and returns the person's provider subject and verified
   * email, or refuses: wrong state, nonce, issuer, audience, signature or an
   * unverified email never reach an account.
   */
  async function verifiedIdentity(provider, { callbackUrl, attempt }) {
    const configuration = await configurationFor(provider);
    let tokens;
    try {
      tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: attempt.codeVerifier,
        expectedState: attempt.state,
        ...(provider.issuer ? { expectedNonce: attempt.nonce, idTokenExpected: true } : {})
      });
    } catch (error) {
      logger?.warn?.({ err: { name: error?.name, code: error?.code, message: error?.message }, provider: provider.id },
        "OAuth sign-in was rejected.");
      throw unverifiedSignIn();
    }
    const identity = await IDENTITY_READERS[provider.id](configuration, tokens, provider);
    const email = normalizeEmail(identity.email);
    if (!email || !identity.subject) {
      throw signInError(401, `${provider.label} did not share an email address.`,
        { code: "auth.local.oauth.emailMissing", provider });
    }
    if (!identity.emailVerified) {
      throw signInError(401, `${provider.label} has not confirmed your email address, so this account can't sign in here.`,
        { code: "auth.local.oauth.emailUnverified", provider });
    }
    return { provider: provider.id, providerSubject: String(identity.subject), email, name: identity.name.slice(0, 160) };
  }

  return Object.freeze({ authorizationUrl, verifiedIdentity });
}

export { createOAuthClients, resolveOAuthProviders };
