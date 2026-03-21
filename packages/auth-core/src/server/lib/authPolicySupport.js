import { asObject } from "./objectUtils.js";

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function assertAuthPolicyDeps(deps = {}) {
  const source = asObject(deps);
  const resolveActor = assertFunction(source.resolveActor, "resolveActor");
  const hasPermission = assertFunction(source.hasPermission, "hasPermission");

  return {
    resolveActor,
    resolveContext: typeof source.resolveContext === "function" ? source.resolveContext : null,
    hasPermission,
    onPolicyDenied: typeof source.onPolicyDenied === "function" ? source.onPolicyDenied : null
  };
}

function normalizeActorResolution(result) {
  const source = asObject(result);
  const actor = Object.hasOwn(source, "actor")
    ? source.actor
    : Object.hasOwn(source, "profile")
      ? source.profile
      : null;

  return {
    authenticated: Boolean(source.authenticated),
    actor,
    transientFailure: Boolean(source.transientFailure)
  };
}

export { assertAuthPolicyDeps, normalizeActorResolution };
