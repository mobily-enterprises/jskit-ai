import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";

function accountSecurityStatusFormatter(securityStatus = {}) {
  const source = securityStatus && typeof securityStatus === "object" ? securityStatus : {};
  const authPolicy = source.authPolicy && typeof source.authPolicy === "object" ? source.authPolicy : {};
  const authMethods = Array.isArray(source.authMethods) ? source.authMethods : [];
  const enabledMethodsCount = authMethods.filter((method) => method?.enabled === true).length;

  return {
    mfa: {
      status: normalizeText(source?.mfa?.status) || "not_enabled",
      enrolled: Boolean(source?.mfa?.enrolled),
      methods: Array.isArray(source?.mfa?.methods) ? source.mfa.methods.map((entry) => normalizeText(entry)).filter(Boolean) : []
    },
    sessions: {
      canSignOutOtherDevices: true
    },
    authPolicy: {
      minimumEnabledMethods: Number(authPolicy.minimumEnabledMethods) > 0 ? Number(authPolicy.minimumEnabledMethods) : 1,
      enabledMethodsCount
    },
    authMethods: authMethods.map((method) => ({
      id: normalizeText(method?.id),
      kind: normalizeText(method?.kind),
      provider: method?.provider == null ? null : normalizeText(method.provider),
      label: normalizeText(method?.label || method?.id),
      configured: method?.configured === true,
      enabled: method?.enabled === true,
      canEnable: method?.canEnable === true,
      canDisable: method?.canDisable === true,
      supportsSecretUpdate: method?.supportsSecretUpdate === true,
      requiresCurrentPassword: method?.requiresCurrentPassword === true
    }))
  };
}

export { accountSecurityStatusFormatter };
