import {
  AUTH_METHOD_DEFINITIONS,
  AUTH_METHOD_EMAIL_OTP_ID,
  AUTH_METHOD_EMAIL_OTP_PROVIDER,
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_PASSWORD,
  AUTH_METHOD_MINIMUM_ENABLED,
  AUTH_METHOD_PASSWORD_ID,
  AUTH_METHOD_PASSWORD_PROVIDER,
  buildOAuthMethodId
} from "../../../../shared/auth/authMethods.js";

function normalizeIdentityProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function collectProviderIdsFromSupabaseUser(user) {
  const providerIds = new Set();

  const appProvider = normalizeIdentityProviderId(user?.app_metadata?.provider);
  if (appProvider) {
    providerIds.add(appProvider);
  }

  const appProviders = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  for (const provider of appProviders) {
    const normalized = normalizeIdentityProviderId(provider);
    if (normalized) {
      providerIds.add(normalized);
    }
  }

  const identities = Array.isArray(user?.identities) ? user.identities : [];
  for (const identity of identities) {
    const normalized = normalizeIdentityProviderId(identity?.provider);
    if (normalized) {
      providerIds.add(normalized);
    }
  }

  return [...providerIds];
}

function buildAuthMethodsStatusFromProviderIds(providerIds, options = {}) {
  const normalizedProviders = Array.isArray(providerIds)
    ? providerIds.map(normalizeIdentityProviderId).filter(Boolean)
    : [];
  const uniqueProviders = new Set(normalizedProviders);
  const passwordSignInEnabled = options.passwordSignInEnabled !== false;
  const passwordSetupRequired = options.passwordSetupRequired === true;
  const methods = [];

  for (const definition of AUTH_METHOD_DEFINITIONS) {
    if (definition.kind === AUTH_METHOD_KIND_PASSWORD) {
      const configured = uniqueProviders.has(AUTH_METHOD_PASSWORD_PROVIDER);
      const enabled = configured && passwordSignInEnabled;
      methods.push({
        id: AUTH_METHOD_PASSWORD_ID,
        kind: AUTH_METHOD_KIND_PASSWORD,
        provider: AUTH_METHOD_PASSWORD_PROVIDER,
        label: definition.label,
        configured,
        enabled,
        canEnable: configured && !enabled,
        canDisable: false,
        supportsSecretUpdate: true,
        requiresCurrentPassword: enabled && !passwordSetupRequired
      });
      continue;
    }

    if (definition.kind === AUTH_METHOD_KIND_OTP) {
      methods.push({
        id: AUTH_METHOD_EMAIL_OTP_ID,
        kind: AUTH_METHOD_KIND_OTP,
        provider: AUTH_METHOD_EMAIL_OTP_PROVIDER,
        label: definition.label,
        configured: true,
        enabled: true,
        canEnable: false,
        canDisable: false,
        supportsSecretUpdate: false,
        requiresCurrentPassword: false
      });
      continue;
    }

    if (definition.kind === AUTH_METHOD_KIND_OAUTH) {
      const provider = normalizeIdentityProviderId(definition.provider);
      const configured = uniqueProviders.has(provider);
      methods.push({
        id: buildOAuthMethodId(provider),
        kind: AUTH_METHOD_KIND_OAUTH,
        provider,
        label: definition.label,
        configured,
        enabled: configured,
        canEnable: !configured,
        canDisable: false,
        supportsSecretUpdate: false,
        requiresCurrentPassword: false
      });
    }
  }

  const enabledMethodsCount = methods.reduce((count, method) => (method.enabled ? count + 1 : count), 0);
  const minimumEnabledMethods = AUTH_METHOD_MINIMUM_ENABLED;
  const canDisableAny = enabledMethodsCount > minimumEnabledMethods;
  const configuredIdentityMethodCount = methods.reduce((count, method) => {
    if (method.kind === AUTH_METHOD_KIND_OAUTH && method.configured) {
      return count + 1;
    }
    if (method.kind === AUTH_METHOD_KIND_PASSWORD && method.configured) {
      return count + 1;
    }
    return count;
  }, 0);

  for (const method of methods) {
    if (method.kind === AUTH_METHOD_KIND_OAUTH) {
      method.canDisable = method.enabled && configuredIdentityMethodCount > 1;
      continue;
    }

    method.canDisable = method.enabled && canDisableAny;
  }

  return {
    methods,
    enabledMethodsCount,
    minimumEnabledMethods,
    canDisableAny
  };
}

function buildAuthMethodsStatusFromSupabaseUser(user, options = {}) {
  return buildAuthMethodsStatusFromProviderIds(collectProviderIdsFromSupabaseUser(user), options);
}

function buildSecurityStatusFromAuthMethodsStatus(authMethodsStatus) {
  const minimumEnabledMethods = Number(authMethodsStatus?.minimumEnabledMethods || AUTH_METHOD_MINIMUM_ENABLED);
  const enabledMethodsCount = Number.isFinite(Number(authMethodsStatus?.enabledMethodsCount))
    ? Number(authMethodsStatus.enabledMethodsCount)
    : Array.isArray(authMethodsStatus?.methods)
      ? authMethodsStatus.methods.reduce((count, method) => (method?.enabled ? count + 1 : count), 0)
      : 0;

  return {
    mfa: {
      status: "not_enabled",
      enrolled: false,
      methods: []
    },
    authPolicy: {
      minimumEnabledMethods,
      enabledMethodsCount
    },
    authMethods: Array.isArray(authMethodsStatus?.methods) ? authMethodsStatus.methods : []
  };
}

function findAuthMethodById(authMethodsStatus, methodId) {
  const normalizedMethodId = String(methodId || "")
    .trim()
    .toLowerCase();
  if (!normalizedMethodId || !Array.isArray(authMethodsStatus?.methods)) {
    return null;
  }

  return authMethodsStatus.methods.find(
    (method) =>
      String(method?.id || "")
        .trim()
        .toLowerCase() === normalizedMethodId
  );
}

function findLinkedIdentityByProvider(user, provider) {
  const normalizedProvider = normalizeIdentityProviderId(provider);
  const identities = Array.isArray(user?.identities) ? user.identities : [];

  for (const identity of identities) {
    if (normalizeIdentityProviderId(identity?.provider) === normalizedProvider) {
      return identity;
    }
  }

  return null;
}

export {
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider
};
