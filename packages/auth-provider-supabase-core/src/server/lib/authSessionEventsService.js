import { normalizePositiveInteger } from "@jskit-ai/kernel/shared/support/normalize";

function createAuthSessionEventsService() {
  async function notifySessionChanged(options = {}) {
    const actorId = normalizePositiveInteger(options?.context?.actor?.id);
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
