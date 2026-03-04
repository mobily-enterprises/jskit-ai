class ContactControllerStage3 {
  constructor({ qualificationService }) {
    this.qualificationService = qualificationService;
    this.contacts = [];
  }

  async intake(request, reply) {
    const qualified = this.qualificationService.qualify(request.body);

    if (!qualified.ok) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: qualified.code,
        details: qualified.details
      });
      return;
    }

    const duplicate = this.contacts.find((entry) => entry.email === qualified.normalized.email);
    if (duplicate) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: "duplicate_contact",
        details: ["a contact with this email already exists"]
      });
      return;
    }

    const created = {
      id: `contact-${Date.now().toString(36)}`,
      ...qualified.normalized,
      score: qualified.score,
      segment: qualified.segment
    };

    this.contacts.push(created);

    reply.code(200).send({
      ok: true,
      mode: "intake",
      email: created.email,
      score: created.score,
      segment: created.segment,
      followupPlan: qualified.followupPlan,
      duplicateDetected: false,
      persisted: true
    });
  }

  async previewFollowup(request, reply) {
    const qualified = this.qualificationService.qualify(request.body);

    if (!qualified.ok) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: qualified.code,
        details: qualified.details
      });
      return;
    }

    const duplicate = this.contacts.find((entry) => entry.email === qualified.normalized.email);

    reply.code(200).send({
      ok: true,
      mode: "preview",
      email: qualified.normalized.email,
      score: qualified.score,
      segment: qualified.segment,
      followupPlan: qualified.followupPlan,
      duplicateDetected: Boolean(duplicate),
      persisted: false
    });
  }
}

export { ContactControllerStage3 };
