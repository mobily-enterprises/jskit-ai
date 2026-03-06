class CreateContactIntakeActionStage7 {
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
    if (duplicate) {
      return {
        ok: false,
        status: 422,
        code: "duplicate_contact",
        details: ["a contact with this email already exists"]
      };
    }

    const score = this.qualificationService.score(normalizedPayload);
    const segment = this.qualificationService.segment(score);
    const followupPlan = this.qualificationService.followupPlan({
      segment,
      source: normalizedPayload.source
    });

    const created = this.contactRepository.save({
      id: `contact-${Date.now().toString(36)}`,
      ...normalizedPayload,
      score,
      segment
    });

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: "intake",
        email: created.email,
        score: created.score,
        segment: created.segment,
        followupPlan,
        duplicateDetected: false,
        persisted: true
      }
    };
  }
}

export { CreateContactIntakeActionStage7 };
