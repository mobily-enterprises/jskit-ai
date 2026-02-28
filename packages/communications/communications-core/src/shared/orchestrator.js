import {
  COMMUNICATION_CHANNELS,
  assertDispatchProvider,
  normalizeChannel,
  normalizeMetadata
} from "@jskit-ai/communications-provider-core";

function createDispatchRegistry({ providers = [] } = {}) {
  const byChannel = new Map();

  for (const provider of providers) {
    const validProvider = assertDispatchProvider(provider, { name: "communicationsProvider" });
    const channel = normalizeChannel(validProvider.channel);
    if (!channel) {
      continue;
    }
    byChannel.set(channel, validProvider);
  }

  return {
    hasChannel(channel) {
      return byChannel.has(normalizeChannel(channel));
    },
    resolveProvider(channel) {
      return byChannel.get(normalizeChannel(channel)) || null;
    }
  };
}

function createOrchestrator({
  smsService,
  emailService,
  providers = [],
  onDispatch = null
} = {}) {
  const registry = createDispatchRegistry({ providers });

  async function dispatchByUseCase({ channel, payload, metadata = {} } = {}) {
    const normalizedChannel = normalizeChannel(channel);
    const provider = registry.resolveProvider(normalizedChannel);
    const normalizedPayload = payload && typeof payload === "object" ? payload : {};

    let result = null;
    if (provider) {
      result = await provider.dispatch({ payload: normalizedPayload, metadata: normalizeMetadata(metadata) });
    } else if (normalizedChannel === COMMUNICATION_CHANNELS.SMS) {
      if (!smsService || typeof smsService.sendSms !== "function") {
        throw new Error("smsService.sendSms is required for sms dispatch.");
      }
      result = await smsService.sendSms({
        ...(normalizedPayload || {}),
        metadata: normalizeMetadata(normalizedPayload.metadata)
      });
    } else if (normalizedChannel === COMMUNICATION_CHANNELS.EMAIL) {
      if (!emailService || typeof emailService.sendEmail !== "function") {
        throw new Error("emailService.sendEmail is required for email dispatch.");
      }
      result = await emailService.sendEmail({
        ...(normalizedPayload || {}),
        metadata: normalizeMetadata(normalizedPayload.metadata)
      });
    } else {
      throw new Error(`Unsupported communication channel: ${normalizedChannel}`);
    }

    if (typeof onDispatch === "function") {
      onDispatch({
        channel: normalizedChannel,
        payload: normalizedPayload,
        result
      });
    }

    return result;
  }

  return {
    dispatchByUseCase
  };
}

export { createOrchestrator, createDispatchRegistry, normalizeMetadata };
