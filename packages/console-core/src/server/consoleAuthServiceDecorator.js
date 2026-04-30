import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeRequestPathname(request = null) {
  const candidates = [
    request?.routeOptions?.url,
    request?.routerPath,
    request?.url,
    request?.raw?.url
  ];

  for (const candidate of candidates) {
    const raw = String(candidate || "").trim();
    if (!raw) {
      continue;
    }
    const withoutQuery = raw.split("?")[0];
    const pathname = withoutQuery.split("#")[0];
    if (pathname) {
      return pathname;
    }
  }

  return "";
}

function createConsoleAuthServiceDecorator({ consoleService } = {}) {
  if (!consoleService || typeof consoleService.ensureInitialConsoleMember !== "function") {
    throw new Error("createConsoleAuthServiceDecorator requires consoleService.ensureInitialConsoleMember().");
  }

  let consoleOwnerInitialized = false;

  return Object.freeze({
    decoratorId: "console.core.authServiceDecorator",
    order: 0,
    decorateAuthService(authService) {
      if (!authService || typeof authService.authenticateRequest !== "function") {
        return authService;
      }

      return Object.freeze(
        Object.assign(Object.create(authService), {
          async authenticateRequest(request, ...args) {
            const authResult = await authService.authenticateRequest(request, ...args);
            if (consoleOwnerInitialized) {
              return authResult;
            }

            const requestPathname = normalizeRequestPathname(request);
            if (requestPathname !== AUTH_PATHS.SESSION) {
              return authResult;
            }

            const authenticatedUserId =
              authResult?.authenticated === true
                ? normalizeRecordId(authResult?.profile?.id, { fallback: null })
                : null;

            if (!authenticatedUserId) {
              return authResult;
            }

            const ownerUserId = normalizeRecordId(
              await consoleService.ensureInitialConsoleMember(authenticatedUserId),
              { fallback: null }
            );
            if (ownerUserId) {
              consoleOwnerInitialized = true;
            }

            return authResult;
          }
        })
      );
    }
  });
}

export { createConsoleAuthServiceDecorator };
