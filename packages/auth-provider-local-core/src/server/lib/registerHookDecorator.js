const LOCAL_AUTH_USER_REGISTERED_EVENT = "auth.local.user.registered";

function assertBlockingMode(hook) {
  if (typeof hook.blocking !== "boolean") {
    throw new TypeError("Local auth register hooks must set blocking to true or false.");
  }
}

/**
 * @param {LocalAuthRegisterHook} hook
 */
function normalizeRegisterHook(hook) {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
    throw new TypeError("createLocalAuthRegisterHookDecorator requires a hook object.");
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

/**
 * What an application's register hook is: `blocking` hooks run before register
 * answers, and their errors fail it; the others run after, and their errors are
 * logged.
 * @typedef {object} LocalAuthRegisterHook
 * @property {string} [hookId]
 * @property {boolean} blocking
 * @property {(payload: { event: string, actor: object, authResult: object }) => unknown} handle
 */

/**
 * @param {object} failure
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} failure.logger
 * @param {{ hookId: string }} failure.hook
 * @param {unknown} failure.error
 */
function logNonBlockingHookFailure({ logger, hook, error }) {
  const payload = {
    err: error,
    hook: hook.hookId,
    event: LOCAL_AUTH_USER_REGISTERED_EVENT
  };
  logger.warn(payload, "Non-blocking local auth register hook failed.");
}

/**
 * @param {object} run
 * @param {{ hookId: string, blocking: boolean, handle: LocalAuthRegisterHook["handle"] }} run.hook
 * @param {object} run.result The answer of register, or of an oauthComplete that registered the user.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} run.logger
 */
async function runRegisterHook({ hook, result, logger }) {
  const payload = Object.freeze({
    event: LOCAL_AUTH_USER_REGISTERED_EVENT,
    actor: result.actor,
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
 * An auth service decorator that runs an application's hook for each user
 * that registers, by password or by a first OAuth sign-in.
 * @param {object} options
 * @param {string} [options.decoratorId]
 * @param {number} [options.order]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} options.logger Reports a failed non-blocking hook.
 * @param {LocalAuthRegisterHook} options.hook
 */
function createLocalAuthRegisterHookDecorator({ decoratorId = "auth.local.registerHook", order = 0, logger, hook }) {
  const registerHook = normalizeRegisterHook(hook);
  // readable-check: allow method-probe - input validation: the logger an application passes
  if (typeof logger?.warn !== "function") {
    throw new TypeError("createLocalAuthRegisterHookDecorator requires a logger.");
  }

  /** @param {import("@jskit-ai/auth-core/server/types").AuthService} authService */
  function decorateAuthService(authService) {
    return Object.freeze(
      Object.defineProperties(Object.create(authService), {
        register: {
          enumerable: true,
          value: async function register(input) {
            const result = await authService.register(input);
            await runRegisterHook({ hook: registerHook, result, logger });
            return result;
          }
        },
        // A first sign-in through a provider creates the user the way register does.
        oauthComplete: {
          enumerable: true,
          value: async function oauthComplete(input, request) {
            const result = await authService.oauthComplete(input, request);
            if (result.registered === true) {
              await runRegisterHook({ hook: registerHook, result, logger });
            }
            return result;
          }
        }
      })
    );
  }

  return Object.freeze({
    decoratorId: String(decoratorId),
    order: Number.isFinite(order) ? Number(order) : 0,
    decorateAuthService
  });
}

export {
  LOCAL_AUTH_USER_REGISTERED_EVENT,
  createLocalAuthRegisterHookDecorator
};
