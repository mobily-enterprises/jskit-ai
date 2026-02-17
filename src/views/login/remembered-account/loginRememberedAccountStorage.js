import { normalizeEmail } from "../../../../shared/auth/utils.js";

const REMEMBERED_ACCOUNT_STORAGE_KEY = "auth.rememberedAccount";

function isLocalStorageAvailable() {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }

  try {
    const key = "__auth_hint_probe__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function maskEmail(emailAddress) {
  const normalized = normalizeEmail(emailAddress);
  const separatorIndex = normalized.indexOf("@");
  if (separatorIndex <= 0) {
    return normalized;
  }

  const localPart = normalized.slice(0, separatorIndex);
  const domainPart = normalized.slice(separatorIndex + 1);
  const visiblePrefix = localPart.slice(0, 1);
  return `${visiblePrefix}***@${domainPart}`;
}

export function createRememberedAccountHint({
  email: accountEmail,
  displayName,
  maskedEmail: accountMaskedEmail,
  lastUsedAt
}) {
  const normalizedEmail = normalizeEmail(accountEmail);
  const normalizedDisplayName = String(displayName || "").trim() || normalizedEmail.split("@")[0] || "User";
  if (!normalizedDisplayName) {
    return null;
  }

  const normalizedLastUsedAt = String(lastUsedAt || new Date().toISOString());
  const maskedEmail =
    typeof accountEmail === "string" && accountEmail.includes("@")
      ? maskEmail(accountEmail)
      : String(accountMaskedEmail || "").trim();

  return {
    displayName: normalizedDisplayName,
    maskedEmail,
    lastUsedAt: normalizedLastUsedAt
  };
}

export function readRememberedAccountHint() {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return createRememberedAccountHint(parsed);
  } catch {
    return null;
  }
}

export function writeRememberedAccountHint(hint) {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(
      REMEMBERED_ACCOUNT_STORAGE_KEY,
      JSON.stringify({
        displayName: hint.displayName,
        maskedEmail: hint.maskedEmail,
        lastUsedAt: hint.lastUsedAt
      })
    );
  } catch {
    // best effort only
  }
}

export function clearRememberedAccountHint() {
  if (!isLocalStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.removeItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
  } catch {
    // best effort only
  }
}
