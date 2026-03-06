class CreateContactIntakeActionStage7 {
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
    if (duplicate) {
      return {
        ok: false,
        status: 422,
        code: "duplicate_contact",
        details: ["a contact with this email already exists"]
      };
    }

    const created = this.contactRepository.save({
      id: `contact-${Date.now().toString(36)}`,
      ...qualified.normalized,
      score: qualified.score,
      segment: qualified.segment
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
        followupPlan: qualified.followupPlan,
        duplicateDetected: false,
        persisted: true
      }
    };
  }
}

export { CreateContactIntakeActionStage7 };
