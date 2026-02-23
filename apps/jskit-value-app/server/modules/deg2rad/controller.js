function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function resolveUsageEventKey(request) {
  return (
    normalizeHeaderValue(request?.headers?.["idempotency-key"]) ||
    normalizeHeaderValue(request?.headers?.["x-command-id"]) ||
    null
  );
}

function resolveRequestId(request) {
  return (
    normalizeHeaderValue(request?.headers?.["x-command-id"]) ||
    normalizeHeaderValue(request?.headers?.["idempotency-key"]) ||
    null
  );
}

function createController({ deg2radService, deg2radHistoryService, billingService = null }) {
  if (!deg2radHistoryService || typeof deg2radHistoryService.appendCalculation !== "function") {
    throw new Error("deg2radHistoryService.appendCalculation is required.");
  }

  const executeWithEntitlementConsumption =
    billingService && typeof billingService.executeWithEntitlementConsumption === "function"
      ? billingService.executeWithEntitlementConsumption.bind(billingService)
      : null;

  async function calculate(request, reply) {
    const user = request.user;
    const workspaceId = request.workspace?.id;
    const payload = request.body || {};
    const normalizedInput = deg2radService.validateAndNormalizeInput(payload);
    const runCalculation = async ({ trx = null } = {}) => {
      const result = deg2radService.calculateDeg2rad(normalizedInput);
      const historyEntry = await deg2radHistoryService.appendCalculation(
        workspaceId,
        user.id,
        result,
        trx ? { trx } : {}
      );

      return {
        result: {
          ...result,
          historyId: historyEntry.id
        }
      };
    };

    const execution = executeWithEntitlementConsumption
      ? await executeWithEntitlementConsumption({
          request,
          user,
          capability: "deg2rad.calculate",
          usageEventKey: resolveUsageEventKey(request),
          requestId: resolveRequestId(request),
          metadataJson: {
            capability: "deg2rad.calculate",
            workspaceId: workspaceId == null ? null : Number(workspaceId),
            calculator: "DEG2RAD"
          },
          action: ({ trx } = {}) => runCalculation({ trx })
        })
      : await runCalculation();

    reply.code(200).send(execution.result);
  }

  return {
    calculate
  };
}

export { createController };
