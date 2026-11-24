import { asObject } from "./objectUtils.js";

const AUTH_POLICIES = Object.freeze({
  PUBLIC: "public",
  REQUIRED: "required",
  OWN: "own"
});

const CONTEXT_POLICIES = Object.freeze({
  NONE: "none",
  OPTIONAL: "optional",
  REQUIRED: "required"
});

const DEFAULT_AUTH_POLICY_META = Object.freeze({
  authPolicy: AUTH_POLICIES.PUBLIC,
  contextPolicy: CONTEXT_POLICIES.NONE,
  surface: "",
  permission: "",
  ownerParam: null,
  userField: "id",
  ownerResolver: null,
  csrfProtection: true,
  secondFactor: false,
  credentials: "cookies"
});

// What signs a route's caller in: the session cookies of a browser, or (credentials: "bearer") the Authorization
// header of a connected client alone, which no browser page can forge, so such a route takes no CSRF token.
const ROUTE_CREDENTIALS = Object.freeze(["cookies", "bearer"]);

function resolveRouteCredentials(value) {
  if (value === undefined || value === null || value === "") return "cookies";
  if (!ROUTE_CREDENTIALS.includes(value)) {
    throw new TypeError(`A route's credentials are "cookies" or "bearer", not ${JSON.stringify(value)}.`);
  }
  return value;
}

function resolveAuthPolicyMeta(input = {}) {
  const source = asObject(input);
  return {
    authPolicy: source.authPolicy || AUTH_POLICIES.PUBLIC,
    contextPolicy: source.contextPolicy || CONTEXT_POLICIES.NONE,
    surface: String(source.surface || "").trim(),
    permission: String(source.permission || "").trim(),
    ownerParam: typeof source.ownerParam === "string" && source.ownerParam ? source.ownerParam : null,
    userField: source.userField || "id",
    // readable-check: allow method-probe - data: a route's auth policy config may name an owner resolver
    ownerResolver: typeof source.ownerResolver === "function" ? source.ownerResolver : null,
    csrfProtection: source.csrfProtection !== false,
    // The route's second factor requirement, as the kernel router checked it: false, true or { maxAgeSeconds }.
    secondFactor: source.secondFactor || false,
    credentials: resolveRouteCredentials(source.credentials)
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

export { AUTH_POLICIES, CONTEXT_POLICIES, DEFAULT_AUTH_POLICY_META, resolveAuthPolicyMeta, withAuthPolicy, mergeAuthPolicy };
