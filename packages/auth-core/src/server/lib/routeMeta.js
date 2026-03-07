const AUTH_POLICIES = Object.freeze({
  PUBLIC: "public",
  REQUIRED: "required",
  OWN: "own"
});

const WORKSPACE_POLICIES = Object.freeze({
  NONE: "none",
  OPTIONAL: "optional",
  REQUIRED: "required"
});

const DEFAULT_AUTH_POLICY_META = Object.freeze({
  authPolicy: AUTH_POLICIES.PUBLIC,
  workspacePolicy: WORKSPACE_POLICIES.NONE,
  workspaceSurface: "",
  permission: "",
  ownerParam: null,
  userField: "id",
  ownerResolver: null,
  csrfProtection: true
});

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function resolveAuthPolicyMeta(input = {}) {
  const source = asObject(input);
  return {
    authPolicy: source.authPolicy || AUTH_POLICIES.PUBLIC,
    workspacePolicy: source.workspacePolicy || WORKSPACE_POLICIES.NONE,
    workspaceSurface: String(source.workspaceSurface || "").trim(),
    permission: String(source.permission || "").trim(),
    ownerParam: typeof source.ownerParam === "string" && source.ownerParam ? source.ownerParam : null,
    userField: source.userField || "id",
    ownerResolver: typeof source.ownerResolver === "function" ? source.ownerResolver : null,
    csrfProtection: source.csrfProtection !== false
  };
}

function withAuthPolicy(meta = {}) {
  return {
    config: resolveAuthPolicyMeta(meta)
  };
}

function mergeAuthPolicy(routeOptions = {}, meta = {}) {
  const sourceRouteOptions = asObject(routeOptions);
  const sourceConfig = asObject(sourceRouteOptions.config);
  const sourceMeta = asObject(meta);
  const normalizedMeta = resolveAuthPolicyMeta({
    ...sourceConfig,
    ...sourceMeta
  });

  return {
    ...sourceRouteOptions,
    config: {
      ...sourceConfig,
      ...normalizedMeta
    }
  };
}

export { AUTH_POLICIES, WORKSPACE_POLICIES, DEFAULT_AUTH_POLICY_META, resolveAuthPolicyMeta, withAuthPolicy, mergeAuthPolicy };
