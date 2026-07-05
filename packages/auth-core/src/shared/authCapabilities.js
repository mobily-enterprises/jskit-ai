import { normalizeOAuthProviderId } from "./oauthProviders.js";

const AUTH_PASSWORD_RECOVERY_DELIVERIES = Object.freeze(["smtp", "dev-log", "dev-response", "disabled"]);

const AUTH_OPTIONAL_OPERATION_FEATURES = Object.freeze({
  register: "password.register",
  resendRegisterConfirmation: "emailConfirmation",
  login: "password.login",
  requestOtpLogin: "otp.login",
  verifyOtpLogin: "otp.login",
  oauthStart: "oauthLogin.enabled",
  oauthComplete: "oauthLogin.enabled",
  requestPasswordReset: "passwordRecovery.request",
  completePasswordRecovery: "passwordRecovery.complete",
  resetPassword: "passwordRecovery.complete",
  changePassword: "password.change",
  updateDisplayName: "profileUpdate",
  getSecurityStatus: "securityStatus",
  setPasswordSignInEnabled: "password.methodToggle",
  startProviderLink: "providerLinking.start",
  unlinkProvider: "providerLinking.unlink",
  signOutOtherSessions: "signOutOtherSessions",
  devLoginAs: "devLoginAs"
});

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback === true;
}

function normalizeAuthProviderId(value, { fallback = "unknown" } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (/^[a-z][a-z0-9_-]{1,63}$/.test(normalized)) {
    return normalized;
  }

  return fallback;
}

function normalizeProviderLabel(value, providerId) {
  const label = String(value || "").trim();
  if (label) {
    return label;
  }
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

function normalizeOAuthProviderEntries(value) {
  const source = Array.isArray(value) ? value : [];
  const providers = [];
  const seen = new Set();

  for (const entry of source) {
    const rawId = typeof entry === "string" ? entry : entry?.id;
    const id = normalizeOAuthProviderId(rawId, { fallback: null });
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    providers.push(Object.freeze({
      id,
      label: String((typeof entry === "object" && entry ? entry.label : "") || id).trim() || id
    }));
  }

  return Object.freeze(providers);
}

function normalizeRecoveryDelivery(value, { request = false, complete = false } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (AUTH_PASSWORD_RECOVERY_DELIVERIES.includes(normalized)) {
    return normalized;
  }
  return request || complete ? "disabled" : "disabled";
}

function normalizeAuthCapabilities(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const providerSource = source.provider && typeof source.provider === "object" ? source.provider : {};
  const providerId = normalizeAuthProviderId(providerSource.id || source.providerId, { fallback: "unknown" });
  const featuresSource = source.features && typeof source.features === "object" ? source.features : {};

  const passwordSource = featuresSource.password && typeof featuresSource.password === "object"
    ? featuresSource.password
    : {};
  const recoverySource = featuresSource.passwordRecovery && typeof featuresSource.passwordRecovery === "object"
    ? featuresSource.passwordRecovery
    : {};
  const otpSource = featuresSource.otp && typeof featuresSource.otp === "object"
    ? featuresSource.otp
    : {};
  const oauthSource = featuresSource.oauthLogin && typeof featuresSource.oauthLogin === "object"
    ? featuresSource.oauthLogin
    : {};
  const providerLinkingSource = featuresSource.providerLinking && typeof featuresSource.providerLinking === "object"
    ? featuresSource.providerLinking
    : {};
  const oauthProviders = normalizeOAuthProviderEntries(oauthSource.providers);
  const oauthDefaultProvider = normalizeOAuthProviderId(oauthSource.defaultProvider, { fallback: null });
  const recoveryRequest = normalizeBoolean(recoverySource.request);
  const recoveryComplete = normalizeBoolean(recoverySource.complete);

  return Object.freeze({
    provider: Object.freeze({
      id: providerId,
      label: normalizeProviderLabel(providerSource.label, providerId)
    }),
    features: Object.freeze({
      password: Object.freeze({
        login: normalizeBoolean(passwordSource.login),
        register: normalizeBoolean(passwordSource.register),
        change: normalizeBoolean(passwordSource.change),
        methodToggle: normalizeBoolean(passwordSource.methodToggle)
      }),
      passwordRecovery: Object.freeze({
        request: recoveryRequest,
        complete: recoveryComplete,
        delivery: normalizeRecoveryDelivery(recoverySource.delivery, {
          request: recoveryRequest,
          complete: recoveryComplete
        })
      }),
      otp: Object.freeze({
        login: normalizeBoolean(otpSource.login)
      }),
      oauthLogin: Object.freeze({
        enabled: normalizeBoolean(oauthSource.enabled) && oauthProviders.length > 0,
        providers: oauthProviders,
        defaultProvider: oauthProviders.some((provider) => provider.id === oauthDefaultProvider)
          ? oauthDefaultProvider
          : null
      }),
      emailConfirmation: normalizeBoolean(featuresSource.emailConfirmation),
      profileUpdate: normalizeBoolean(featuresSource.profileUpdate),
      providerLinking: Object.freeze({
        start: normalizeBoolean(providerLinkingSource.start),
        unlink: normalizeBoolean(providerLinkingSource.unlink)
      }),
      securityStatus: normalizeBoolean(featuresSource.securityStatus),
      signOutOtherSessions: normalizeBoolean(featuresSource.signOutOtherSessions),
      appProfileProjection: normalizeBoolean(featuresSource.appProfileProjection),
      devLoginAs: normalizeBoolean(featuresSource.devLoginAs)
    })
  });
}

function getCapabilityFeature(capabilities, path) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return undefined;
  }

  let current = normalizeAuthCapabilities(capabilities).features;
  for (const segment of normalizedPath.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function isAuthOperationSupported(capabilities, operationName) {
  const path = AUTH_OPTIONAL_OPERATION_FEATURES[String(operationName || "").trim()];
  if (!path) {
    return true;
  }
  return getCapabilityFeature(capabilities, path) === true;
}

export {
  AUTH_PASSWORD_RECOVERY_DELIVERIES,
  AUTH_OPTIONAL_OPERATION_FEATURES,
  normalizeAuthProviderId,
  normalizeAuthCapabilities,
  getCapabilityFeature,
  isAuthOperationSupported
};
