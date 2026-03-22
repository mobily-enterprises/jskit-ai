import { normalizeEmailAddress, maskEmail } from "./identityHelpers.js";

const REMEMBERED_ACCOUNT_STORAGE_KEY = "auth.rememberedAccount";

function resolveLocalStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const probeKey = "__auth_hint_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

function createRememberedAccountHint({ email: accountEmail, displayName, maskedEmail, lastUsedAt } = {}) {
  const normalizedEmail = normalizeEmailAddress(accountEmail);
  if (!normalizedEmail) {
    return null;
  }

  const normalizedDisplayName = String(displayName || "").trim() || normalizedEmail.split("@")[0] || "User";
  const normalizedMaskedEmail =
    normalizedEmail.includes("@") && !maskedEmail ? maskEmail(normalizedEmail) : String(maskedEmail || "").trim();

  return {
    email: normalizedEmail,
    displayName: normalizedDisplayName,
    maskedEmail: normalizedMaskedEmail,
    lastUsedAt: String(lastUsedAt || new Date().toISOString())
  };
}

function readRememberedAccountHint() {
  const storage = resolveLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue);
    return createRememberedAccountHint(parsed);
  } catch {
    return null;
  }
}

function writeRememberedAccountHint(hint) {
  const storage = resolveLocalStorage();
  if (!storage || !hint) {
    return;
  }

  try {
    storage.setItem(
      REMEMBERED_ACCOUNT_STORAGE_KEY,
      JSON.stringify({
        email: hint.email,
        displayName: hint.displayName,
        maskedEmail: hint.maskedEmail,
        lastUsedAt: hint.lastUsedAt
      })
    );
  } catch {
    // best effort only
  }
}

function clearRememberedAccountHint() {
  const storage = resolveLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
  } catch {
    // best effort only
  }
}

export {
  createRememberedAccountHint,
  readRememberedAccountHint,
  writeRememberedAccountHint,
  clearRememberedAccountHint
};
