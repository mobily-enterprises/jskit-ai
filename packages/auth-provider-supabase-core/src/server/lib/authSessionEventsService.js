import { createAuthorizedService } from "@jskit-ai/kernel/server/runtime";

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }
  return parsed;
}

function createAuthSessionEventsService() {
  const servicePermissions = Object.freeze({
    notifySessionChanged: Object.freeze({
      require: "none",
      permissions: Object.freeze([])
    })
  });

  async function notifySessionChanged(options = {}) {
    const actorId = toPositiveInteger(options?.context?.actor?.id);
    if (!actorId) {
      return null;
    }

    return {
      id: actorId
    };
  }

  return createAuthorizedService(
    {
      notifySessionChanged
    },
    servicePermissions
  );
}

export { createAuthSessionEventsService };
