import { normalizePermissionList } from "@jskit-ai/kernel/shared/support/permissions";

function normalizeOrderedExtension(value, { idField, method, label } = {}) {
  // readable-check: allow method-probe - input validation: an application registers the extension
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

/**
 * The invitation context resolver when no feature registers one: an invitation
 * keeps the token and source it arrived with.
 * @type {import("./types.js").AuthInvitationContextResolver}
 */
const invitationAsGiven = Object.freeze({
  resolverId: "auth.invitation.as-given",
  async resolveInvitationContext({ token, source }) {
    return { token, source };
  }
});

function createAuthExtensions() {
  const serviceDecorators = [];
  const policyContextResolvers = [];
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

  // readable-check: allow setter-seam - cycle: workspaces.integrations requires auth.service through workspaces.core and users.core
  function registerInvitationContextResolver(extension) {
    return register(invitationContextResolvers, extension, {
      idField: "resolverId",
      method: "resolveInvitationContext",
      label: "Auth invitation context resolver"
    });
  }

  function resolveInvitationContextResolver() {
    sealed = true;
    const entries = ordered(invitationContextResolvers);
    if (entries.length > 1) {
      throw new Error(`Auth invitation context resolver is ambiguous: ${entries.map((entry) => entry.resolverId).join(", ")}.`);
    }
    return entries[0] || invitationAsGiven;
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
      invitationContextResolverIds: Object.freeze(ordered(invitationContextResolvers).map((entry) => entry.resolverId))
    });
  }

  const api = Object.freeze({
    registerServiceDecorator,
    registerPolicyContextResolver,
    registerInvitationContextResolver,
    decorateService,
    resolvePolicyContext,
    resolveInvitationContextResolver,
    diagnostics
  });
  return api;
}

export { createAuthExtensions, invitationAsGiven, mergePolicyContexts };
