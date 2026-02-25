import {
  createPermissionEvaluator,
  ensureActionChannelAllowed,
  ensureActionSurfaceAllowed,
  ensureActionVisibilityAllowed,
  normalizeActionInput,
  normalizeActionOutput
} from "./policies.js";
import {
  createNoopIdempotencyAdapter,
  resolveActionIdempotencyKey,
  ensureIdempotencyKeyIfRequired
} from "./idempotency.js";
import { createNoopAuditAdapter } from "./audit.js";
import { createNoopObservabilityAdapter } from "./observability.js";
import { normalizeExecutionContext } from "./executionContext.js";

function normalizeOutcomeErrorCode(error) {
  return String(error?.code || "ACTION_EXECUTION_FAILED").trim();
}

function buildActionLogPayload({ definition, context, outcome, durationMs, errorCode, idempotencyReplay }) {
  return {
    action: definition?.id,
    version: definition?.version,
    channel: context?.channel,
    surface: context?.surface,
    requestId: context?.requestMeta?.requestId || null,
    durationMs,
    outcome,
    errorCode: errorCode || null,
    idempotencyReplay: Boolean(idempotencyReplay)
  };
}

async function emitAuditEvent(adapter, payload) {
  if (!adapter || typeof adapter.emitExecution !== "function") {
    return;
  }

  await adapter.emitExecution(payload);
}

async function executeIdempotencyClaim(adapter, payload) {
  if (!adapter || typeof adapter.claimOrReplay !== "function") {
    return {
      type: "proceed",
      idempotencyReplay: false,
      claim: null,
      replayResult: null
    };
  }

  const result = await adapter.claimOrReplay(payload);
  if (!result || typeof result !== "object") {
    return {
      type: "proceed",
      idempotencyReplay: false,
      claim: null,
      replayResult: null
    };
  }

  return {
    type: String(result.type || "proceed"),
    idempotencyReplay: result.idempotencyReplay === true,
    claim: result.claim || null,
    replayResult: Object.hasOwn(result, "replayResult") ? result.replayResult : null
  };
}

async function executeActionPipeline({
  definition,
  input,
  context,
  deps = {},
  permissionEvaluator,
  idempotencyAdapter,
  auditAdapter,
  observabilityAdapter,
  logger = console
} = {}) {
  const normalizedContext = normalizeExecutionContext(context);
  const authorizationEvaluator =
    permissionEvaluator && typeof permissionEvaluator.evaluate === "function"
      ? permissionEvaluator
      : createPermissionEvaluator();
  const normalizedIdempotencyAdapter = idempotencyAdapter || createNoopIdempotencyAdapter();
  const normalizedAuditAdapter = auditAdapter || createNoopAuditAdapter();
  const normalizedObservabilityAdapter = observabilityAdapter || createNoopObservabilityAdapter();
  const startedAt = Date.now();

  if (typeof normalizedObservabilityAdapter.recordExecutionStart === "function") {
    normalizedObservabilityAdapter.recordExecutionStart({
      definition,
      context: normalizedContext
    });
  }

  let idempotencyKey = "";
  let idempotencyClaim = null;

  try {
    ensureActionChannelAllowed(definition, normalizedContext);
    ensureActionSurfaceAllowed(definition, normalizedContext);
    ensureActionVisibilityAllowed(definition, normalizedContext);

    const normalizedInput = await normalizeActionInput(definition, input, normalizedContext);
    const permissionResolution = await authorizationEvaluator.evaluate({
      definition,
      context: normalizedContext,
      input: normalizedInput
    });

    if (!permissionResolution?.allowed) {
      if (typeof normalizedObservabilityAdapter.recordAuthorizationDenied === "function") {
        normalizedObservabilityAdapter.recordAuthorizationDenied({
          definition,
          context: normalizedContext,
          reason: permissionResolution?.reason || "forbidden",
          code: permissionResolution?.code || "ACTION_PERMISSION_DENIED"
        });
      }

      throw Object.assign(new Error("Forbidden."), {
        status: 403,
        statusCode: 403,
        code: permissionResolution?.code || "ACTION_PERMISSION_DENIED"
      });
    }

    idempotencyKey = resolveActionIdempotencyKey(definition, normalizedContext);
    ensureIdempotencyKeyIfRequired(definition, normalizedContext, idempotencyKey);

    const idempotencyPolicy = String(definition?.idempotency || "none").trim().toLowerCase();
    if (idempotencyPolicy !== "none") {
      const claimResult = await executeIdempotencyClaim(normalizedIdempotencyAdapter, {
        definition,
        context: normalizedContext,
        input: normalizedInput,
        idempotencyKey
      });

      idempotencyClaim = claimResult.claim;
      if (claimResult.type === "replay") {
        if (typeof normalizedObservabilityAdapter.recordIdempotentReplay === "function") {
          normalizedObservabilityAdapter.recordIdempotentReplay({
            definition,
            context: normalizedContext
          });
        }

        const replayDurationMs = Date.now() - startedAt;
        if (typeof normalizedObservabilityAdapter.recordExecutionFinish === "function") {
          normalizedObservabilityAdapter.recordExecutionFinish({
            definition,
            context: normalizedContext,
            outcome: "replay",
            durationMs: replayDurationMs,
            idempotencyReplay: true
          });
        }

        await emitAuditEvent(normalizedAuditAdapter, {
          definition,
          context: normalizedContext,
          outcome: "success",
          result: claimResult.replayResult,
          error: null,
          durationMs: replayDurationMs,
          idempotencyReplay: true
        });

        if (logger && typeof logger.debug === "function") {
          logger.debug(
            buildActionLogPayload({
              definition,
              context: normalizedContext,
              outcome: "replay",
              durationMs: replayDurationMs,
              errorCode: null,
              idempotencyReplay: true
            }),
            "action.execution"
          );
        }

        return {
          result: claimResult.replayResult,
          idempotencyReplay: true
        };
      }
    }

    const executionResult = await definition.execute(normalizedInput, normalizedContext, deps);
    const normalizedResult = await normalizeActionOutput(definition, executionResult, normalizedContext);

    if (idempotencyClaim && typeof normalizedIdempotencyAdapter.markSucceeded === "function") {
      await normalizedIdempotencyAdapter.markSucceeded({
        definition,
        context: normalizedContext,
        input: normalizedInput,
        result: normalizedResult,
        claim: idempotencyClaim,
        idempotencyKey
      });
    }

    const durationMs = Date.now() - startedAt;
    if (typeof normalizedObservabilityAdapter.recordExecutionFinish === "function") {
      normalizedObservabilityAdapter.recordExecutionFinish({
        definition,
        context: normalizedContext,
        outcome: "success",
        durationMs,
        idempotencyReplay: false
      });
    }

    await emitAuditEvent(normalizedAuditAdapter, {
      definition,
      context: normalizedContext,
      outcome: "success",
      result: normalizedResult,
      error: null,
      durationMs,
      idempotencyReplay: false
    });

    if (logger && typeof logger.debug === "function") {
      logger.debug(
        buildActionLogPayload({
          definition,
          context: normalizedContext,
          outcome: "success",
          durationMs,
          errorCode: null,
          idempotencyReplay: false
        }),
        "action.execution"
      );
    }

    return {
      result: normalizedResult,
      idempotencyReplay: false
    };
  } catch (error) {
    const executionError = error;

    if (executionError?.code === "ACTION_VALIDATION_FAILED") {
      if (typeof normalizedObservabilityAdapter.recordValidationFailure === "function") {
        normalizedObservabilityAdapter.recordValidationFailure({
          definition,
          context: normalizedContext,
          error: executionError
        });
      }
    }

    if (idempotencyClaim && typeof normalizedIdempotencyAdapter.markFailed === "function") {
      await normalizedIdempotencyAdapter.markFailed({
        definition,
        context: normalizedContext,
        input,
        error: executionError,
        claim: idempotencyClaim,
        idempotencyKey
      });
    }

    const durationMs = Date.now() - startedAt;
    const errorCode = normalizeOutcomeErrorCode(executionError);

    if (typeof normalizedObservabilityAdapter.recordExecutionFinish === "function") {
      normalizedObservabilityAdapter.recordExecutionFinish({
        definition,
        context: normalizedContext,
        outcome: "failure",
        durationMs,
        error: executionError,
        errorCode,
        idempotencyReplay: false
      });
    }

    await emitAuditEvent(normalizedAuditAdapter, {
      definition,
      context: normalizedContext,
      outcome: "failure",
      result: null,
      error: executionError,
      durationMs,
      idempotencyReplay: false
    });

    if (logger && typeof logger.debug === "function") {
      logger.debug(
        buildActionLogPayload({
          definition,
          context: normalizedContext,
          outcome: "failure",
          durationMs,
          errorCode,
          idempotencyReplay: false
        }),
        "action.execution"
      );
    }

    throw executionError;
  }
}

export { executeActionPipeline };
