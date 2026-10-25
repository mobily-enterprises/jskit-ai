import {
  ensureActionChannelAllowed,
  ensureActionSurfaceAllowed,
  ensureActionPermissionAllowed,
  normalizeActionInput,
  normalizeActionOutput
} from "./policies.js";
import { ensureIdempotencyKeyIfRequired } from "./idempotency.js";
import { normalizeExecutionContext } from "./executionContext.js";

async function publishActionEvents(events, builders, execution) {
  if (!Array.isArray(builders) || builders.length === 0) return;
  if (!events || typeof events.publish !== "function") {
    throw new TypeError("Action event publishing requires runtime.events.publish().");
  }
  for (const builder of builders) {
    const built = await builder(execution);
    const values = Array.isArray(built) ? built : [built];
    for (const event of values) {
      if (event != null) await events.publish(event);
    }
  }
}

function logActionExecution(logger, { definition, context, outcome, startedAt, errorCode = null }) {
  if (!logger || typeof logger.debug !== "function") {
    return;
  }
  logger.debug(
    {
      action: definition?.id,
      version: definition?.version,
      channel: context?.channel,
      surface: context?.surface,
      requestId: context?.requestMeta?.requestId || null,
      durationMs: Date.now() - startedAt,
      outcome,
      errorCode
    },
    "action.execution"
  );
}

async function executeActionPipeline({
  definition,
  input,
  context,
  deps = {},
  events,
  logger = console
} = {}) {
  const normalizedContext = normalizeExecutionContext(context);
  const startedAt = Date.now();

  try {
    ensureActionChannelAllowed(definition, normalizedContext);
    ensureActionSurfaceAllowed(definition, normalizedContext);
    ensureActionPermissionAllowed(definition, normalizedContext);

    const normalizedInput = await normalizeActionInput(definition, input);
    ensureIdempotencyKeyIfRequired(definition, normalizedContext);

    const executionResult = await definition.execute(normalizedInput, normalizedContext, deps);
    const normalizedResult = await normalizeActionOutput(definition, executionResult);

    await publishActionEvents(events, definition.events, Object.freeze({
      definition,
      input: normalizedInput,
      result: normalizedResult,
      context: normalizedContext
    }));

    logActionExecution(logger, { definition, context: normalizedContext, outcome: "success", startedAt });
    return normalizedResult;
  } catch (error) {
    logActionExecution(logger, {
      definition,
      context: normalizedContext,
      outcome: "failure",
      startedAt,
      errorCode: String(error?.code || "ACTION_EXECUTION_FAILED").trim()
    });
    throw error;
  }
}

export { executeActionPipeline };
