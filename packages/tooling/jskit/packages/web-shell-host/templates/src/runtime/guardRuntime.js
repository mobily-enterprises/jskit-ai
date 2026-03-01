import { redirect } from "@tanstack/vue-router";

const GLOBAL_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";

function resolveGuardEvaluator() {
  if (typeof globalThis !== "object" || !globalThis) {
    return null;
  }
  const evaluator = globalThis[GLOBAL_GUARD_EVALUATOR_KEY];
  if (typeof evaluator !== "function") {
    return null;
  }
  return evaluator;
}

function normalizeGuardOutcome(result) {
  if (result == null || result === true) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  if (result === false) {
    return {
      allow: false,
      redirectTo: "",
      reason: ""
    };
  }

  if (typeof result !== "object" || Array.isArray(result)) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  return {
    allow: result.allow !== false,
    redirectTo: String(result.redirectTo || "").trim(),
    reason: String(result.reason || "").trim()
  };
}

function evaluateShellGuard({ guard, phase, context }) {
  if (!guard || typeof guard !== "object") {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  const evaluator = resolveGuardEvaluator();
  if (!evaluator) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  try {
    return normalizeGuardOutcome(
      evaluator({
        guard,
        phase,
        context
      })
    );
  } catch {
    return {
      allow: false,
      redirectTo: "",
      reason: "guard-evaluator-error"
    };
  }
}

function createBeforeLoadFromGuard(guard) {
  if (!guard || typeof guard !== "object") {
    return undefined;
  }

  return (context) => {
    const outcome = evaluateShellGuard({
      guard,
      phase: "route",
      context
    });

    if (outcome.allow) {
      return undefined;
    }

    if (outcome.redirectTo) {
      throw redirect({
        to: outcome.redirectTo
      });
    }

    throw new Error(`Route blocked by shell guard${outcome.reason ? ` (${outcome.reason})` : ""}.`);
  };
}

export { evaluateShellGuard, createBeforeLoadFromGuard };
