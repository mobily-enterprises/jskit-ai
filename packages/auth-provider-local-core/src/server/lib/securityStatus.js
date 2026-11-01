import { AUTH_METHOD_KIND_OAUTH, buildOAuthMethodId } from "@jskit-ai/auth-core/shared/authMethods";
import { buildSecurityStatusFromAuthMethodsStatus } from "@jskit-ai/auth-core/shared/authSecurityStatus";
import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { hasPassword } from "./accounts.js";

/**
 * The sign-in methods of an account: its password and each configured provider.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {Map<string, import("../types.js").AuthLocalOAuthProvider>} dependencies.oauthProvidersById
 * @param {import("../types.js").AuthLocalSessions} dependencies.sessions
 */
function createLocalSecurityStatus({ backend, config, oauthProvidersById, sessions }) {
  const { oauthProviders } = config;
  const oauthEnabled = oauthProviders.length > 0;

  async function securityStatusForUser(userId) {
    const { user, identities } = await backend.withTransaction(async (tx) => ({
      user: await tx.users.findById(userId),
      identities: oauthEnabled ? await tx.identities.listForUser(userId) : []
    }));
    const passwordSet = hasPassword(user);
    // Identities of a provider the app no longer configures cannot sign in.
    const linkedProviders = new Set(identities.map((identity) => identity.provider).filter((id) => oauthProvidersById.has(id)));
    const signInMethodCount = (passwordSet ? 1 : 0) + linkedProviders.size;
    const methods = [
      {
        id: "password",
        kind: "password",
        provider: "email",
        label: "Password",
        configured: passwordSet,
        enabled: passwordSet,
        canDisable: false,
        supportsSecretUpdate: true,
        requiresCurrentPassword: false
      },
      // canEnable links the provider and canDisable unlinks it, as for Supabase.
      ...oauthProviders.map((provider) => {
        const linked = linkedProviders.has(provider.id);
        return {
          id: buildOAuthMethodId(provider.id),
          kind: AUTH_METHOD_KIND_OAUTH,
          provider: provider.id,
          label: provider.label,
          configured: linked,
          enabled: linked,
          canEnable: !linked,
          canDisable: linked && signInMethodCount > 1,
          supportsSecretUpdate: false,
          requiresCurrentPassword: false
        };
      })
    ];
    return buildSecurityStatusFromAuthMethodsStatus(
      {
        methods,
        minimumEnabledMethods: 1,
        enabledMethodsCount: signInMethodCount
      },
      {
        actions: {
          changePassword: passwordSet,
          signOutOtherSessions: true,
          linkProvider: oauthEnabled,
          unlinkProvider: oauthEnabled
        }
      }
    );
  }

  async function getSecurityStatus(request) {
    const authResult = await sessions.authenticateRequest(request);
    if (authResult.authenticated !== true) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    return securityStatusForUser(authResult.actor.providerUserId);
  }

  return Object.freeze({
    securityStatusForUser,
    getSecurityStatus
  });
}

export { createLocalSecurityStatus };
