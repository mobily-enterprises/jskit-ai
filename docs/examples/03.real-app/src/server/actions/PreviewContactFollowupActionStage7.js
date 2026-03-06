class PreviewContactFollowupActionStage7 {
  constructor({ qualificationService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.contactRepository = contactRepository;
  }

  execute(normalizedPayload) {
    const details = this.qualificationService.validate(normalizedPayload);
    if (details.length > 0) {
      return {
        ok: false,
        status: 422,
        code: "domain_validation_failed",
        details
      };
    }

    const duplicate = this.contactRepository.findByEmail(normalizedPayload.email);
    const score = this.qualificationService.score(normalizedPayload);
    const segment = this.qualificationService.segment(score);
    const followupPlan = this.qualificationService.followupPlan({
      segment,
      source: normalizedPayload.source
    });

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: "preview",
        email: normalizedPayload.email,
        score,
        segment,
        followupPlan,
        duplicateDetected: Boolean(duplicate),
        persisted: false
      }
    };
  }
}

export { PreviewContactFollowupActionStage7 };
