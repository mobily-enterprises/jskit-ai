function createAnnuityController({ annuityService, annuityHistoryService }) {
  async function calculate(request, reply) {
    const user = request.user;
    const payload = request.body || {};
    const normalizedInput = annuityService.validateAndNormalizeInput(payload);
    const result = annuityService.calculateAnnuity(normalizedInput);
    const historyEntry = await annuityHistoryService.appendCalculation(user.id, result);

    reply.code(200).send({
      ...result,
      historyId: historyEntry.id
    });
  }

  return {
    calculate
  };
}

export { createAnnuityController };
