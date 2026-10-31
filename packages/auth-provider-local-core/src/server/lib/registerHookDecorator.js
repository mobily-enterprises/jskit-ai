const LOCAL_AUTH_USER_REGISTERED_EVENT = "auth.local.user.registered";

function assertBlockingMode(hook) {
  if (typeof hook?.blocking !== "boolean") {
    throw new TypeError("Local auth register hooks must set blocking to true or false.");
  }
}

function normalizeRegisterHook(hook = null) {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
    return null;
  }
  assertBlockingMode(hook);
  // readable-check: allow method-probe - input validation: the hook an application passes
  if (typeof hook.handle !== "function") {
    throw new TypeError("Local auth register hook handle must be a function.");
  }
  return Object.freeze({
    hookId: String(hook.hookId || "anonymous"),
    blocking: hook.blocking,
    handle: hook.handle
  });
}

// Without a logger, a failed non-blocking hook is reported on the console.
const consoleLogger = Object.freeze({
  warn(payload, message) {
    console.warn(message, payload);
  }
});

/** @typedef {Pick<import("@jskit-ai/kernel/server/types").RuntimeLogger, "warn">} RegisterHookLogger */

/**
 * @param {object} failure
 * @param {RegisterHookLogger} failure.logger
 * @param {{ hookId: string }} failure.hook
 * @param {unknown} failure.error
 */
function logNonBlockingHookFailure({ logger, hook, error }) {
  const payload = {
    err: error,
    hook: hook?.hookId || "anonymous",
    event: LOCAL_AUTH_USER_REGISTERED_EVENT
  };
  logger.warn(payload, "Non-blocking local auth register hook failed.");
}

async function runRegisterHook({ hook, result, logger }) {
  if (!hook) {
    return;
  }

  const payload = Object.freeze({
    event: LOCAL_AUTH_USER_REGISTERED_EVENT,
    actor: result?.actor || null,
    authResult: result
  });

  if (hook.blocking) {
    await hook.handle(payload);
    return;
  }

  Promise.resolve()
    .then(() => hook.handle(payload))
    .catch((error) => logNonBlockingHookFailure({ logger, hook, error }));
}

/**
 * @param {object} [options]
 * @param {string} [options.decoratorId]
 * @param {number} [options.order]
 * @param {RegisterHookLogger} [options.logger] Reports a failed non-blocking hook; the console by default.
 * @param {object | null} [options.hook]
 */
function createLocalAuthRegisterHookDecorator({
  decoratorId = "auth.local.registerHook",
  order = 0,
  logger = consoleLogger,
  hook = null
} = {}) {
  const registerHook = normalizeRegisterHook(hook);

  if (!registerHook) {
    throw new TypeError("createLocalAuthRegisterHookDecorator requires a hook object.");
  }

  return Object.freeze({
    decoratorId: String(decoratorId || registerHook.hookId || "auth.local.registerHook"),
    order: Number.isFinite(order) ? Number(order) : 0,
    /** @param {import("@jskit-ai/auth-core/server/types").AuthService} authService */
    decorateAuthService(authService) {
      // readable-check: allow method-probe - optional operation: register is an optional auth.service operation
      if (typeof authService.register !== "function") {
        return authService;
      }

      return Object.freeze(
        Object.defineProperties(Object.create(authService), {
          register: {
            enumerable: true,
            value: async function register(input = {}) {
              const result = await authService.register(input);
              await runRegisterHook({ hook: registerHook, result, logger });
              return result;
            }
          },
          // A first sign-in through a provider creates the user the way register does.
          oauthComplete: {
            enumerable: true,
            value: async function oauthComplete(input = {}, request = null) {
              const result = await authService.oauthComplete(input, request);
              if (result?.registered === true) {
                await runRegisterHook({ hook: registerHook, result, logger });
              }
              return result;
            }
          }
        })
      );
    }
  });
}

export {
  LOCAL_AUTH_USER_REGISTERED_EVENT,
  createLocalAuthRegisterHookDecorator
};
