function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function createService({ smsService }) {
  if (!smsService || typeof smsService.sendSms !== "function") {
    throw new Error("smsService is required.");
  }

  async function sendSms(payload = {}) {
    const request = payload && typeof payload === "object" ? payload : {};

    return smsService.sendSms({
      to: request.to,
      text: request.text,
      metadata: normalizeMetadata(request.metadata)
    });
  }

  return {
    sendSms
  };
}

const __testables = {
  normalizeMetadata
};

export { createService, __testables };
