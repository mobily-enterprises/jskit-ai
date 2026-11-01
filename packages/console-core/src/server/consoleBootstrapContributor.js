import { normalizeObject, normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

/** @param {{ consoleService: import("./types.js").ConsoleService }} dependencies */
function createConsoleBootstrapContributor({ consoleService }) {
  async function contribute({ payload }) {
    const session = normalizeObject(payload.session);
    const surfaceAccess = normalizeObject(payload.surfaceAccess);
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

  return Object.freeze({ contribute });
}

export { createConsoleBootstrapContributor };
