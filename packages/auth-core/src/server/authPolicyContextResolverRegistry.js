import { mergePolicyContexts } from "./authExtensions.js";

/**
 * @param {import("./types.js").AuthExtensions} extensions
 * @param {object} resolver
 */
function registerAuthPolicyContextResolver(extensions, resolver) {
  return extensions.registerPolicyContextResolver(resolver);
}

/** @param {import("./types.js").AuthExtensions} extensions */
function resolveComposedAuthPolicyContextResolver(extensions) {
  return (input = {}) => extensions.resolvePolicyContext(input);
}

export {
  registerAuthPolicyContextResolver,
  resolveComposedAuthPolicyContextResolver,
  mergePolicyContexts
};
