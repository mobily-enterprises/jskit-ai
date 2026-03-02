import { buildAuditEventBase, buildAuditError } from "@jskit-ai/server-runtime-core/securityAudit";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { resolveSurfaceFromPathname } from "../../../shared/surfacePaths.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeOutcome(outcome) {
  return outcome === "failure" ? "failure" : "success";
}

function createActionAuditAdapter({ auditService, logger = console } = {}) {
  if (!auditService || typeof auditService.recordSafe !== "function") {
    return {
      async emitExecution() {}
    };
  }

  async function emitExecution({ definition, context, outcome, result, error, durationMs, idempotencyReplay }) {
    const request = context?.requestMeta?.request || null;
    const metadataBuilder = definition?.audit?.metadataBuilder;
    let metadata = {};

    if (typeof metadataBuilder === "function") {
      try {
        const resolvedMetadata = await metadataBuilder({
          definition,
          context,
          outcome,
          result,
          error,
          durationMs,
          idempotencyReplay
        });
        metadata = resolvedMetadata && typeof resolvedMetadata === "object" ? resolvedMetadata : {};
      } catch (metadataError) {
        if (logger && typeof logger.warn === "function") {
          logger.warn(
            {
              actionId: definition?.id,
              metadataError: buildAuditError(metadataError)
            },
            "action.audit.metadata_builder_failed"
          );
        }
      }
    }

    const baseAuditPayload = request
      ? buildAuditEventBase(request, {
          resolveSurfaceFromPathname
        })
      : {
          actorUserId: parsePositiveInteger(context?.actor?.id),
          actorEmail: normalizeText(context?.actor?.email).toLowerCase(),
          surface: normalizeText(context?.surface || "app").toLowerCase(),
          requestId: normalizeText(context?.requestMeta?.requestId),
          method: "",
          path: "",
          ipAddress: normalizeText(context?.requestMeta?.ip),
          userAgent: normalizeText(context?.requestMeta?.userAgent)
        };

    const auditEvent = {
      ...baseAuditPayload,
      action: normalizeText(definition?.audit?.actionName || definition?.id),
      outcome: normalizeOutcome(outcome),
      metadata: {
        ...metadata,
        actionId: normalizeText(definition?.id),
        actionVersion: Number(definition?.version || 1),
        channel: normalizeText(context?.channel),
        durationMs: Number(durationMs) || 0,
        idempotencyReplay: idempotencyReplay === true
      }
    };

    if (error) {
      auditEvent.metadata.error = buildAuditError(error);
    }

    await auditService.recordSafe(auditEvent, request?.log);
  }

  return {
    emitExecution
  };
}

export { createActionAuditAdapter };
