import { mergePolicyContexts } from "./authExtensions.js";

function registerAuthPolicyContextResolver(extensions, resolver) {
  if (!extensions || typeof extensions.registerPolicyContextResolver !== "function") {
    throw new TypeError("registerAuthPolicyContextResolver requires auth.extensions.");
  }
  return extensions.registerPolicyContextResolver(resolver);
}

function resolveComposedAuthPolicyContextResolver(extensions) {
  if (!extensions || typeof extensions.resolvePolicyContext !== "function") return null;
  return (input = {}) => extensions.resolvePolicyContext(input);
}

export {
  registerAuthPolicyContextResolver,
  resolveComposedAuthPolicyContextResolver,
  mergePolicyContexts
};
