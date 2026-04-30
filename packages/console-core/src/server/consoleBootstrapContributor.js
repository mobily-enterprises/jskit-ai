import { normalizeObject, normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function createConsoleBootstrapContributor({ consoleService } = {}) {
  if (!consoleService || typeof consoleService.isConsoleOwnerUserId !== "function") {
    throw new Error("createConsoleBootstrapContributor requires consoleService.isConsoleOwnerUserId().");
  }

  return Object.freeze({
    contributorId: "console.bootstrap",
    order: 300,
    async contribute({ payload = {} } = {}) {
      const normalizedPayload = normalizeObject(payload);
      const session = normalizeObject(normalizedPayload.session);
      const surfaceAccess = normalizeObject(normalizedPayload.surfaceAccess);
      const authenticatedUserId =
        session.authenticated === true ? normalizeRecordId(session.userId, { fallback: null }) : null;

      let consoleOwner = false;
      if (authenticatedUserId) {
        consoleOwner = await consoleService.isConsoleOwnerUserId(authenticatedUserId);
      }

      return {
        surfaceAccess: {
          ...surfaceAccess,
          consoleowner: consoleOwner
        }
      };
    }
  });
}

export { createConsoleBootstrapContributor };
