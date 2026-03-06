import { NotFoundError } from "@jskit-ai/kernel/server/runtime";

class GetContactByIdActionStage7 {
  constructor({ contactRepository }) {
    this.contactRepository = contactRepository;
  }

  async execute({ contactId }) {
    const normalizedId = String(contactId || "").trim();
    const contact = this.contactRepository.findById(normalizedId);

    if (!contact) {
      throw new NotFoundError("Contact not found.", {
        code: "contact_not_found",
        details: {
          contactId: normalizedId
        }
      });
    }

    return {
      ok: true,
      contact
    };
  }
}

export { GetContactByIdActionStage7 };
