import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMfa(source) {
  const mfaSource = isRecord(source?.mfa) ? source.mfa : {};
  const methods = [];
  for (const entry of Array.isArray(mfaSource.methods) ? mfaSource.methods : []) {
    const normalized = normalizeText(entry);
    if (!normalized) {
      continue;
    }
    methods.push(normalized);
  }

  return {
    status: normalizeText(mfaSource.status) || "not_enabled",
    enrolled: Boolean(mfaSource.enrolled),
    methods
  };
}

function normalizeAuthMethods(sourceMethods) {
  const methods = [];
  let enabledMethodsCount = 0;

  for (const method of Array.isArray(sourceMethods) ? sourceMethods : []) {
    const normalizedMethod = {
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
    };

    if (normalizedMethod.enabled) {
      enabledMethodsCount += 1;
    }
    methods.push(normalizedMethod);
  }

  return {
    methods,
    enabledMethodsCount
  };
}

function accountSecurityStatusFormatter(securityStatus = {}) {
  const source = isRecord(securityStatus) ? securityStatus : {};
  const authPolicy = isRecord(source.authPolicy) ? source.authPolicy : {};
  const { methods: authMethods, enabledMethodsCount } = normalizeAuthMethods(source.authMethods);
  const minimumEnabledMethods = Number(authPolicy.minimumEnabledMethods);

  return {
    mfa: normalizeMfa(source),
    sessions: {
      canSignOutOtherDevices: true
    },
    authPolicy: {
      minimumEnabledMethods: minimumEnabledMethods > 0 ? minimumEnabledMethods : 1,
      enabledMethodsCount
    },
    authMethods
  };
}

export { accountSecurityStatusFormatter };
