const COMMUNICATION_CHANNELS = Object.freeze({
  SMS: "sms",
  EMAIL: "email"
});

const COMMUNICATION_PROVIDER_RESULT_REASONS = Object.freeze([
  "invalid_recipient",
  "invalid_message",
  "not_configured",
  "not_implemented",
  "provider_error"
]);

function normalizeChannel(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || "";
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function assertDispatchProvider(provider, { name = "dispatchProvider" } = {}) {
  if (!provider || typeof provider !== "object") {
    throw new Error(`${name} is required.`);
  }
  if (typeof provider.channel !== "string") {
    throw new Error(`${name}.channel is required.`);
  }
  if (typeof provider.dispatch !== "function") {
    throw new Error(`${name}.dispatch is required.`);
  }
  return provider;
}

export {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_PROVIDER_RESULT_REASONS,
  normalizeChannel,
  normalizeMetadata,
  assertDispatchProvider
};
