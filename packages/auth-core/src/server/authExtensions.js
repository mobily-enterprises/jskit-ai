import { normalizePermissionList } from "@jskit-ai/kernel/shared/support/permissions";

function normalizeOrderedExtension(value, { idField, method, label } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value[method] !== "function") {
    throw new TypeError(`${label} requires ${method}().`);
  }
  const id = String(value[idField] || "").trim();
  if (!id) {
    throw new TypeError(`${label} requires ${idField}.`);
  }
  return Object.freeze({
    ...value,
    [idField]: id,
    order: Number.isFinite(value.order) ? Number(value.order) : 0,
    [method]: value[method]
  });
}

function ordered(values) {
  return values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value.order - right.value.order || left.index - right.index)
    .map(({ value }) => value);
}

function mergePolicyContexts(contexts = []) {
  const merged = {};
  const permissions = new Set();
  for (const context of contexts) {
    if (!context || typeof context !== "object" || Array.isArray(context)) continue;
    for (const [key, value] of Object.entries(context)) {
      if (key === "permissions") {
        for (const permission of normalizePermissionList(value)) permissions.add(permission);
      } else if (value !== undefined) {
        merged[key] = value;
      }
    }
  }
  if (permissions.size > 0) merged.permissions = Object.freeze([...permissions]);
  return Object.keys(merged).length > 0 ? Object.freeze(merged) : null;
}

function createAuthExtensions() {
  const serviceDecorators = [];
  const policyContextResolvers = [];
  const profileProjectors = [];
  const invitationContextResolvers = [];
  const ids = new Set();
  let sealed = false;

  function register(collection, extension, options) {
    if (sealed) throw new Error("Auth extension registration is closed after authentication starts.");
    const normalized = normalizeOrderedExtension(extension, options);
    const qualifiedId = `${options.label}:${normalized[options.idField]}`;
    if (ids.has(qualifiedId)) throw new Error(`${options.label} "${normalized[options.idField]}" is duplicated.`);
    ids.add(qualifiedId);
    collection.push(normalized);
    return api;
  }

  function registerServiceDecorator(extension) {
    return register(serviceDecorators, extension, {
      idField: "decoratorId",
      method: "decorateAuthService",
      label: "Auth service decorator"
    });
  }

  function registerPolicyContextResolver(extension) {
    return register(policyContextResolvers, extension, {
      idField: "resolverId",
      method: "resolveAuthPolicyContext",
      label: "Auth policy context resolver"
    });
  }

  function registerProfileProjector(extension) {
    return register(profileProjectors, extension, {
      idField: "projectorId",
      method: "syncIdentityProfile",
      label: "Auth profile projector"
    });
  }

  function registerInvitationContextResolver(extension) {
    return register(invitationContextResolvers, extension, {
      idField: "resolverId",
      method: "resolveInvitationContext",
      label: "Auth invitation context resolver"
    });
  }

  function resolveSingle(collection, label) {
    sealed = true;
    const entries = ordered(collection);
    if (entries.length > 1) {
      throw new Error(`${label} is ambiguous: ${entries.map((entry) => entry.projectorId || entry.resolverId).join(", ")}.`);
    }
    return entries[0] || null;
  }

  function resolveProfileProjector() {
    return resolveSingle(profileProjectors, "Auth profile projector");
  }

  function resolveInvitationContextResolver() {
    return resolveSingle(invitationContextResolvers, "Auth invitation context resolver");
  }

  function decorateService(authService) {
    sealed = true;
    let decorated = authService;
    for (const decorator of ordered(serviceDecorators)) {
      decorated = decorator.decorateAuthService(decorated);
      if (!decorated || typeof decorated !== "object") {
        throw new Error(`Auth service decorator "${decorator.decoratorId}" must return an auth service object.`);
      }
    }
    return decorated;
  }

  async function resolvePolicyContext(input = {}) {
    sealed = true;
    const contexts = [];
    for (const resolver of ordered(policyContextResolvers)) {
      contexts.push(await resolver.resolveAuthPolicyContext(input));
    }
    return mergePolicyContexts(contexts);
  }

  function diagnostics() {
    return Object.freeze({
      sealed,
      serviceDecoratorIds: Object.freeze(ordered(serviceDecorators).map((entry) => entry.decoratorId)),
      policyContextResolverIds: Object.freeze(ordered(policyContextResolvers).map((entry) => entry.resolverId)),
      profileProjectorIds: Object.freeze(ordered(profileProjectors).map((entry) => entry.projectorId)),
      invitationContextResolverIds: Object.freeze(ordered(invitationContextResolvers).map((entry) => entry.resolverId))
    });
  }

  const api = Object.freeze({
    registerServiceDecorator,
    registerPolicyContextResolver,
    registerProfileProjector,
    registerInvitationContextResolver,
    decorateService,
    resolvePolicyContext,
    resolveProfileProjector,
    resolveInvitationContextResolver,
    diagnostics
  });
  return api;
}

export { createAuthExtensions, mergePolicyContexts };
