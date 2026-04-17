import { normalizeObject, normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function createConsoleBootstrapContributor({ consoleService } = {}) {
  if (!consoleService || typeof consoleService.ensureInitialConsoleMember !== "function") {
    throw new Error("createConsoleBootstrapContributor requires consoleService.ensureInitialConsoleMember().");
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
        const seededConsoleOwnerUserId = normalizeRecordId(
          await consoleService.ensureInitialConsoleMember(authenticatedUserId),
          { fallback: null }
        );
        consoleOwner = Boolean(seededConsoleOwnerUserId) && seededConsoleOwnerUserId === authenticatedUserId;
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
