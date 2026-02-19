const CLIENT_ID_STORAGE_KEY = "jskit.realtime.clientId";

let inMemoryClientId = "";

function canUseSessionStorage() {
  if (typeof window === "undefined" || !window?.sessionStorage) {
    return false;
  }

  try {
    const probeKey = "__realtime_client_id_probe__";
    window.sessionStorage.setItem(probeKey, "1");
    window.sessionStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function generateClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cli_${crypto.randomUUID()}`;
  }

  return `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getClientId() {
  if (canUseSessionStorage()) {
    const existing = String(window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY) || "").trim();
    if (existing) {
      return existing;
    }

    const nextClientId = generateClientId();
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, nextClientId);
    return nextClientId;
  }

  if (!inMemoryClientId) {
    inMemoryClientId = generateClientId();
  }

  return inMemoryClientId;
}

function resetClientIdentityForTests() {
  inMemoryClientId = "";

  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    // ignore test cleanup failures
  }
}

const __testables = {
  canUseSessionStorage,
  generateClientId,
  resetClientIdentityForTests
};

export { getClientId, __testables };
