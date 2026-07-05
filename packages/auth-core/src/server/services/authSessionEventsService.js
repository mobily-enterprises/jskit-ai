import { normalizeOpaqueId } from "@jskit-ai/kernel/shared/support/normalize";

function resolveActorId(context = {}) {
  return normalizeOpaqueId(
    context?.actor?.id ||
      context?.actor?.appUserId ||
      context?.actor?.providerUserId ||
      context?.profile?.id,
    { fallback: null }
  );
}

function createAuthSessionEventsService() {
  async function notifySessionChanged(options = {}) {
    const actorId = resolveActorId(options?.context || {});
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
