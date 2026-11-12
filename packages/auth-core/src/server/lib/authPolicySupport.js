import { asObject } from "./objectUtils.js";

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

/** The onPolicyDenied default when an application passes none: a denial is not reported. */
function ignorePolicyDenial() {}

/** The resolveContext default when an application passes none: a request has no policy context. */
function resolveNoPolicyContext() {
  return null;
}

function assertAuthPolicyDeps(deps = {}) {
  const source = asObject(deps);
  const resolveActor = assertFunction(source.resolveActor, "resolveActor");
  const hasPermission = assertFunction(source.hasPermission, "hasPermission");

  return {
    resolveActor,
    // readable-check: allow method-probe - input validation: the callbacks an application passes authPolicyPlugin
    resolveContext: typeof source.resolveContext === "function" ? source.resolveContext : resolveNoPolicyContext,
    hasPermission,
    // readable-check: allow method-probe - input validation: the callbacks an application passes authPolicyPlugin
    onPolicyDenied: typeof source.onPolicyDenied === "function" ? source.onPolicyDenied : ignorePolicyDenial
  };
}

function normalizeActorResolution(result) {
  const source = asObject(result);

  return {
    authenticated: Boolean(source.authenticated),
    actor: Object.hasOwn(source, "actor") ? source.actor : null,
    // When the session last proved its second factor, as ISO text, or "".
    secondFactorAt: typeof source.secondFactorAt === "string" ? source.secondFactorAt : "",
    transientFailure: Boolean(source.transientFailure)
  };
}

export { assertAuthPolicyDeps, normalizeActorResolution };
