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
  if (typeof hook.handle !== "function") {
    throw new TypeError("Local auth register hook handle must be a function.");
  }
  return Object.freeze({
    hookId: String(hook.hookId || "anonymous"),
    blocking: hook.blocking,
    handle: hook.handle
  });
}

function logNonBlockingHookFailure({ logger, hook, error } = {}) {
  const payload = {
    err: error,
    hook: hook?.hookId || "anonymous",
    event: LOCAL_AUTH_USER_REGISTERED_EVENT
  };
  if (logger && typeof logger.warn === "function") {
    logger.warn(payload, "Non-blocking local auth register hook failed.");
    return;
  }
  console.warn("Non-blocking local auth register hook failed.", payload);
}

async function runRegisterHook({ hook, result, logger }) {
  if (!hook) {
    return;
  }

  const payload = Object.freeze({
    event: LOCAL_AUTH_USER_REGISTERED_EVENT,
    actor: result?.actor || null,
    profile: result?.profile || null,
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

function createLocalAuthRegisterHookDecorator({
  decoratorId = "auth.local.registerHook",
  order = 0,
  logger = null,
  hook = null
} = {}) {
  const registerHook = normalizeRegisterHook(hook);

  if (!registerHook) {
    throw new TypeError("createLocalAuthRegisterHookDecorator requires a hook object.");
  }

  return Object.freeze({
    decoratorId: String(decoratorId || registerHook.hookId || "auth.local.registerHook"),
    order: Number.isFinite(order) ? Number(order) : 0,
    decorateAuthService(authService) {
      if (!authService || typeof authService.register !== "function") {
        return authService;
      }

      return Object.freeze(
        Object.defineProperty(Object.create(authService), "register", {
          enumerable: true,
          value: async function register(input = {}) {
            const result = await authService.register(input);
            await runRegisterHook({ hook: registerHook, result, logger });
            return result;
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
