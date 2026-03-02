function normalizeText(value) {
  return String(value || "").trim();
}

function createActionObservabilityAdapter({ observabilityService, logger = console } = {}) {
  const scopedLogger =
    observabilityService && typeof observabilityService.createScopedLogger === "function"
      ? observabilityService.createScopedLogger("actions.runtime")
      : logger;

  function safeRecord(methodName, payload) {
    const target = observabilityService;
    if (!target || typeof target[methodName] !== "function") {
      return;
    }

    target[methodName](payload);
  }

  function recordExecutionStart({ definition, context }) {
    safeRecord("recordActionExecutionStart", {
      action: definition?.id,
      channel: context?.channel,
      surface: context?.surface
    });
  }

  function recordExecutionFinish({ definition, context, outcome, durationMs, errorCode, idempotencyReplay }) {
    safeRecord("recordActionExecution", {
      action: definition?.id,
      channel: context?.channel,
      surface: context?.surface,
      outcome,
      durationMs,
      errorCode,
      idempotencyReplay: idempotencyReplay === true
    });

    if (scopedLogger && typeof scopedLogger.debug === "function") {
      scopedLogger.debug(
        {
          action: definition?.id,
          channel: context?.channel,
          surface: context?.surface,
          outcome,
          durationMs,
          errorCode: normalizeText(errorCode),
          idempotencyReplay: idempotencyReplay === true
        },
        "action.execution.observed"
      );
    }
  }

  function recordAuthorizationDenied({ definition, context, code }) {
    safeRecord("recordActionAuthorizationDenied", {
      action: definition?.id,
      channel: context?.channel,
      surface: context?.surface,
      code
    });
  }

  function recordValidationFailure({ definition, context }) {
    safeRecord("recordActionValidationFailed", {
      action: definition?.id,
      channel: context?.channel,
      surface: context?.surface
    });
  }

  function recordIdempotentReplay({ definition, context }) {
    safeRecord("recordActionIdempotentReplay", {
      action: definition?.id,
      channel: context?.channel,
      surface: context?.surface
    });
  }

  return {
    recordExecutionStart,
    recordExecutionFinish,
    recordAuthorizationDenied,
    recordValidationFailure,
    recordIdempotentReplay
  };
}

export { createActionObservabilityAdapter };
