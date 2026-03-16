function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }
  return parsed;
}

function createAuthSessionEventsService() {
  async function notifySessionChanged(options = {}) {
    const actorId = toPositiveInteger(options?.context?.actor?.id);
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
