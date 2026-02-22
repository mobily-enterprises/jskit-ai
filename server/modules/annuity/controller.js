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

function createController({ annuityService, annuityHistoryService, billingService = null }) {
  const executeWithEntitlementConsumption =
    billingService && typeof billingService.executeWithEntitlementConsumption === "function"
      ? billingService.executeWithEntitlementConsumption.bind(billingService)
      : null;

  async function calculate(request, reply) {
    const user = request.user;
    const workspaceId = request.workspace?.id;
    const payload = request.body || {};
    const normalizedInput = annuityService.validateAndNormalizeInput(payload);
    const runCalculation = async ({ trx = null } = {}) => {
      const result = annuityService.calculateAnnuity(normalizedInput);
      const historyEntry = await annuityHistoryService.appendCalculation(
        workspaceId,
        user.id,
        result,
        trx ? { trx } : {}
      );
      return {
        result,
        historyEntry
      };
    };

    const execution = executeWithEntitlementConsumption
      ? await executeWithEntitlementConsumption({
          request,
          user,
          capability: "annuity.calculate",
          usageEventKey: resolveUsageEventKey(request),
          requestId: resolveRequestId(request),
          metadataJson: {
            capability: "annuity.calculate",
            workspaceId: workspaceId == null ? null : Number(workspaceId)
          },
          action: ({ trx }) => runCalculation({ trx })
        })
      : await runCalculation();

    reply.code(200).send({
      ...execution.result,
      historyId: execution.historyEntry.id
    });
  }

  return {
    calculate
  };
}

export { createController };
