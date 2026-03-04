class PreviewContactFollowupAction {
  constructor({ qualificationService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.contactRepository = contactRepository;
  }

  execute(payload) {
    const qualified = this.qualificationService.qualify(payload);
    if (!qualified.ok) {
      return {
        ok: false,
        status: 422,
        code: qualified.code,
        details: qualified.details
      };
    }

    const duplicate = this.contactRepository.findByEmail(qualified.normalized.email);

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: "preview",
        email: qualified.normalized.email,
        score: qualified.score,
        segment: qualified.segment,
        followupPlan: qualified.followupPlan,
        duplicateDetected: Boolean(duplicate),
        persisted: false
      }
    };
  }
}

export { PreviewContactFollowupAction };
