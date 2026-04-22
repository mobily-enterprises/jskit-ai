import { normalizePermissionList } from "@jskit-ai/kernel/shared/support/permissions";
import { registerTaggedSingleton, resolveTaggedEntries } from "@jskit-ai/kernel/server/registries";

const AUTH_POLICY_CONTEXT_RESOLVER_TAG = "jskit.auth.policy.context.resolvers";

function normalizeAuthPolicyContextResolver(entry) {
  if (typeof entry === "function") {
    return Object.freeze({
      resolverId: String(entry.name || "anonymous"),
      order: 0,
      resolveAuthPolicyContext: entry
    });
  }

  if (!entry || typeof entry !== "object" || typeof entry.resolveAuthPolicyContext !== "function") {
    return null;
  }

  const resolverId = String(entry.resolverId || "anonymous");
  const order = Number.isFinite(entry.order) ? Number(entry.order) : 0;

  return Object.freeze({
    ...entry,
    resolverId,
    order,
    resolveAuthPolicyContext: entry.resolveAuthPolicyContext
  });
}

function registerAuthPolicyContextResolver(app, token, factory) {
  registerTaggedSingleton(app, token, factory, AUTH_POLICY_CONTEXT_RESOLVER_TAG, {
    context: "registerAuthPolicyContextResolver"
  });
}

function resolveAuthPolicyContextResolvers(scope) {
  return resolveTaggedEntries(scope, AUTH_POLICY_CONTEXT_RESOLVER_TAG)
    .map((entry, index) => ({
      resolver: normalizeAuthPolicyContextResolver(entry),
      index
    }))
    .filter((entry) => Boolean(entry.resolver))
    .sort((left, right) => {
      if (left.resolver.order !== right.resolver.order) {
        return left.resolver.order - right.resolver.order;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.resolver);
}

function mergeAuthPolicyContexts(contexts = []) {
  const merged = {};
  let hasValues = false;
  const permissions = new Set();

  for (const context of Array.isArray(contexts) ? contexts : [contexts]) {
    if (!context || typeof context !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(context)) {
      if (key === "permissions") {
        for (const permission of normalizePermissionList(value)) {
          permissions.add(permission);
        }
        continue;
      }

      if (value === undefined) {
        continue;
      }

      merged[key] = value;
      hasValues = true;
    }
  }

  if (permissions.size > 0) {
    merged.permissions = Object.freeze([...permissions]);
    hasValues = true;
  }

  return hasValues ? Object.freeze(merged) : null;
}

function composeAuthPolicyContextResolvers(resolvers = []) {
  const normalizedResolvers = (Array.isArray(resolvers) ? resolvers : [resolvers])
    .map((entry, index) => ({
      resolver: normalizeAuthPolicyContextResolver(entry),
      index
    }))
    .filter((entry) => Boolean(entry.resolver))
    .sort((left, right) => {
      if (left.resolver.order !== right.resolver.order) {
        return left.resolver.order - right.resolver.order;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.resolver);

  if (normalizedResolvers.length < 1) {
    return null;
  }

  return async function resolveComposedAuthPolicyContext(input = {}) {
    const contexts = [];

    for (const resolver of normalizedResolvers) {
      contexts.push(await resolver.resolveAuthPolicyContext(input));
    }

    return mergeAuthPolicyContexts(contexts);
  };
}

export {
  AUTH_POLICY_CONTEXT_RESOLVER_TAG,
  registerAuthPolicyContextResolver,
  resolveAuthPolicyContextResolvers,
  mergeAuthPolicyContexts,
  composeAuthPolicyContextResolvers
};
