import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function createAuthSessionEventsService() {
  async function notifySessionChanged(options = {}) {
    const actorId = normalizeRecordId(options?.context?.actor?.id, { fallback: null });
    if (!actorId) {
      return null;
    }

    return {
      id: actorId
    };
  }

  return Object.freeze({
    notifySessionChanged
  });
}

export { createAuthSessionEventsService };
