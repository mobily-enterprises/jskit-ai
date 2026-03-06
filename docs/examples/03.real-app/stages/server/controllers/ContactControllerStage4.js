class ContactControllerStage4 {
  constructor({ qualificationService, contactRepository }) {
    this.qualificationService = qualificationService;
    this.contactRepository = contactRepository;
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

    const duplicate = this.contactRepository.findByEmail(qualified.normalized.email);
    if (duplicate) {
      reply.code(422).send({
        error: "Domain validation failed.",
        code: "duplicate_contact",
        details: ["a contact with this email already exists"]
      });
      return;
    }

    const created = this.contactRepository.save({
      id: `contact-${Date.now().toString(36)}`,
      ...qualified.normalized,
      score: qualified.score,
      segment: qualified.segment
    });

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

    const duplicate = this.contactRepository.findByEmail(qualified.normalized.email);

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

  async show(request, reply) {
    const contactId = String(request.params?.contactId || "").trim();
    const found = this.contactRepository.findById(contactId);

    if (!found) {
      reply.code(404).send({
        error: "Contact not found.",
        code: "contact_not_found",
        details: [`No contact found for id ${contactId || "<empty>"}.`]
      });
      return;
    }

    reply.code(200).send({
      ok: true,
      contact: found
    });
  }
}

export { ContactControllerStage4 };
