import { COMMUNICATION_CHANNELS } from "@jskit-ai/communications-provider-core";
import { createOrchestrator, normalizeMetadata } from "./orchestrator.js";

function createService({ smsService, emailService = null, providers = [], onDispatch = null } = {}) {
  if (!smsService || typeof smsService.sendSms !== "function") {
    throw new Error("smsService is required.");
  }

  const orchestrator = createOrchestrator({
    smsService,
    emailService,
    providers,
    onDispatch
  });

  async function sendSms(payload = {}) {
    const request = payload && typeof payload === "object" ? payload : {};
    return orchestrator.dispatchByUseCase({
      channel: COMMUNICATION_CHANNELS.SMS,
      payload: {
        to: request.to,
        text: request.text,
        metadata: normalizeMetadata(request.metadata)
      }
    });
  }

  async function sendEmail(payload = {}) {
    const request = payload && typeof payload === "object" ? payload : {};
    return orchestrator.dispatchByUseCase({
      channel: COMMUNICATION_CHANNELS.EMAIL,
      payload: {
        to: request.to,
        subject: request.subject,
        text: request.text,
        html: request.html,
        metadata: normalizeMetadata(request.metadata)
      }
    });
  }

  return {
    sendSms,
    sendEmail,
    dispatchByUseCase: orchestrator.dispatchByUseCase
  };
}

const __testables = {
  normalizeMetadata
};

export { createService, __testables };
