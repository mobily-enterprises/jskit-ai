class GetContactByIdActionStage5 {
  constructor({ contactRepository }) {
    this.contactRepository = contactRepository;
  }

  execute({ contactId }) {
    const normalizedId = String(contactId || "").trim();
    const contact = this.contactRepository.findById(normalizedId);

    if (!contact) {
      return {
        ok: false,
        status: 404,
        code: "contact_not_found",
        details: [`No contact found for id ${normalizedId || "<empty>"}.`]
      };
    }

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        contact
      }
    };
  }
}

export { GetContactByIdActionStage5 };
