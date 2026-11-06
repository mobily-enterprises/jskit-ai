/**
 * True when NODE_ENV is `production`, in any letter case: the one check every
 * JSKIT package makes to decide production. Anything else, unset included, is
 * development, as is the Node convention; a host that serves the application
 * sets NODE_ENV=production.
 * @param {import("../types.js").RuntimeEnv} env
 */
function isProductionEnv(env) {
  return String(env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

/**
 * Stops a production server's startup when a development-only setting is set,
 * instead of quietly ignoring it, saying what to do.
 * @param {import("../types.js").RuntimeEnv} env
 * @param {ReadonlyArray<string>} names The development-only env names.
 */
function assertDevelopmentOnlySettings(env, names) {
  if (!isProductionEnv(env)) {
    return;
  }
  const set = names.filter((name) => String(env[name] ?? "").trim() !== "");
  if (set.length > 0) {
    throw new Error(
      `${set.join(", ")} ${set.length === 1 ? "is" : "are"} for development only and NODE_ENV is production. ` +
        `Remove ${set.length === 1 ? "it" : "them"} from the production environment.`
    );
  }
}

export { assertDevelopmentOnlySettings, isProductionEnv };
