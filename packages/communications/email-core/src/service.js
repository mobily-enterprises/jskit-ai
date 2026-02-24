function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function createService({ provider = "none" } = {}) {
  const normalizedProvider = String(provider || "none")
    .trim()
    .toLowerCase() || "none";

  async function sendEmail(payload = {}) {
    const request = payload && typeof payload === "object" ? payload : {};
    return {
      sent: false,
      reason: "not_implemented",
      provider: normalizedProvider,
      messageId: null,
      request: {
        to: String(request.to || "").trim(),
        subject: String(request.subject || "").trim(),
        metadata: normalizeMetadata(request.metadata)
      }
    };
  }

  return {
    provider: normalizedProvider,
    sendEmail
  };
}

const __testables = {
  normalizeMetadata
};

export { createService, __testables };
