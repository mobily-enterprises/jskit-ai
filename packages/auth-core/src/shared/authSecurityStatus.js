import { AUTH_METHOD_MINIMUM_ENABLED } from "./authMethods.js";

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback === true;
}

function countEnabledMethods(methods) {
  return methods.filter((method) => method?.enabled === true).length;
}

function normalizeAuthMethodStatus(entry) {
  const source = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  const id = String(source.id || "").trim();
  const kind = String(source.kind || "").trim();
  if (!id || !kind) {
    return null;
  }

  const method = {
    id,
    kind,
    configured: normalizeBoolean(source.configured),
    enabled: normalizeBoolean(source.enabled),
    canDisable: normalizeBoolean(source.canDisable)
  };

  for (const key of [
    "provider",
    "label",
    "canEnable",
    "canUnlink",
    "supportsSecretUpdate",
    "requiresCurrentPassword"
  ]) {
    if (Object.hasOwn(source, key)) {
      method[key] = source[key];
    }
  }

  return Object.freeze(method);
}

function normalizeSecurityActions(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze({
    changePassword: normalizeBoolean(source.changePassword),
    setPasswordEnabled: normalizeBoolean(source.setPasswordEnabled),
    linkProvider: normalizeBoolean(source.linkProvider),
    unlinkProvider: normalizeBoolean(source.unlinkProvider),
    signOutOtherSessions: normalizeBoolean(source.signOutOtherSessions)
  });
}

function normalizeAuthSecurityStatus(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const authMethods = (Array.isArray(source.authMethods) ? source.authMethods : [])
    .map((entry) => normalizeAuthMethodStatus(entry))
    .filter(Boolean);
  const policySource =
    source.policy && typeof source.policy === "object"
      ? source.policy
      : source.authPolicy && typeof source.authPolicy === "object"
        ? source.authPolicy
        : {};
  const minimumEnabledMethods = Number.isInteger(Number(policySource.minimumEnabledMethods))
    ? Math.max(1, Number(policySource.minimumEnabledMethods))
    : AUTH_METHOD_MINIMUM_ENABLED;
  const enabledMethodsCount = Number.isInteger(Number(policySource.enabledMethodsCount))
    ? Math.max(0, Number(policySource.enabledMethodsCount))
    : countEnabledMethods(authMethods);
  const policy = Object.freeze({
    minimumEnabledMethods,
    enabledMethodsCount
  });
  const actions = normalizeSecurityActions(source.actions);

  return Object.freeze({
    mfa: source.mfa && typeof source.mfa === "object"
      ? Object.freeze({
          status: String(source.mfa.status || "not_enabled"),
          enrolled: normalizeBoolean(source.mfa.enrolled),
          methods: Object.freeze(Array.isArray(source.mfa.methods) ? [...source.mfa.methods] : [])
        })
      : Object.freeze({
          status: "not_enabled",
          enrolled: false,
          methods: Object.freeze([])
        }),
    policy,
    authPolicy: policy,
    actions,
    authMethods: Object.freeze(authMethods)
  });
}

function buildSecurityStatusFromAuthMethodsStatus(authMethodsStatus, { actions = {} } = {}) {
  const source = authMethodsStatus && typeof authMethodsStatus === "object" ? authMethodsStatus : {};
  return normalizeAuthSecurityStatus({
    authMethods: Array.isArray(source.methods) ? source.methods : [],
    policy: {
      minimumEnabledMethods: source.minimumEnabledMethods,
      enabledMethodsCount: source.enabledMethodsCount
    },
    actions
  });
}

export {
  normalizeAuthSecurityStatus,
  buildSecurityStatusFromAuthMethodsStatus
};
