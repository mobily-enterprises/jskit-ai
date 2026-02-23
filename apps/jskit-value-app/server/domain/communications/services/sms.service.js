const SUPPORTED_DRIVERS = new Set(["none", "plivo"]);
const E164_PHONE_REGEX = /^\+[1-9][0-9]{7,14}$/;
const MAX_SMS_LENGTH = 1600;

function normalizeDriver(value) {
  const normalized = String(value || "none")
    .trim()
    .toLowerCase();

  if (!SUPPORTED_DRIVERS.has(normalized)) {
    throw new Error(`Unsupported SMS_DRIVER "${normalized}". Supported: none, plivo.`);
  }

  return normalized;
}

function normalizePhoneNumber(value) {
  const normalized = String(value || "").trim();
  if (!normalized || !E164_PHONE_REGEX.test(normalized)) {
    return "";
  }

  return normalized;
}

function normalizeMessageText(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > MAX_SMS_LENGTH) {
    return "";
  }

  return normalized;
}

function normalizePlivoConfig(options = {}) {
  return {
    authId: String(options.plivoAuthId || "").trim(),
    authToken: String(options.plivoAuthToken || "").trim(),
    sourceNumber: normalizePhoneNumber(options.plivoSourceNumber)
  };
}

function hasPlivoConfig(config) {
  return Boolean(config.authId && config.authToken && config.sourceNumber);
}

function createService(options = {}) {
  const driver = normalizeDriver(options.driver);
  const plivoConfig = normalizePlivoConfig(options);

  async function sendSms(payload = {}) {
    const to = normalizePhoneNumber(payload.to);
    if (!to) {
      return {
        sent: false,
        reason: "invalid_recipient",
        provider: driver,
        messageId: null
      };
    }

    const text = normalizeMessageText(payload.text);
    if (!text) {
      return {
        sent: false,
        reason: "invalid_message",
        provider: driver,
        messageId: null
      };
    }

    if (driver === "none") {
      return {
        sent: false,
        reason: "not_configured",
        provider: driver,
        messageId: null
      };
    }

    if (!hasPlivoConfig(plivoConfig)) {
      return {
        sent: false,
        reason: "not_configured",
        provider: driver,
        messageId: null
      };
    }

    return {
      sent: false,
      reason: "not_implemented",
      provider: driver,
      messageId: null
    };
  }

  return {
    driver,
    sendSms
  };
}

const __testables = {
  SUPPORTED_DRIVERS,
  E164_PHONE_REGEX,
  MAX_SMS_LENGTH,
  normalizeDriver,
  normalizePhoneNumber,
  normalizeMessageText,
  normalizePlivoConfig,
  hasPlivoConfig
};

export { createService, __testables };
