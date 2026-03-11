import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

function createService({ contactsRepository } = {}) {
  if (!contactsRepository) {
    throw new Error("contactsService requires contactsRepository.");
  }

  async function listContacts(query = {}, options = {}) {
    return contactsRepository.list(query, options);
  }

  async function getContact(contactId, options = {}) {
    const contact = await contactsRepository.findById(contactId, options);
    if (!contact) {
      throw new AppError(404, "Contact not found.");
    }

    return contact;
  }

  async function createContact(payload = {}, options = {}) {
    const contact = await contactsRepository.create(payload, options);
    if (!contact) {
      throw new Error("contactsService could not load the created contact.");
    }

    return contact;
  }

  async function updateContact(contactId, payload = {}, options = {}) {
    const contact = await contactsRepository.updateById(contactId, payload, options);
    if (!contact) {
      throw new AppError(404, "Contact not found.");
    }

    return contact;
  }

  async function deleteContact(contactId, options = {}) {
    const deleted = await contactsRepository.deleteById(contactId, options);
    if (!deleted) {
      throw new AppError(404, "Contact not found.");
    }

    return deleted;
  }

  return Object.freeze({
    listContacts,
    getContact,
    createContact,
    updateContact,
    deleteContact
  });
}

export { createService };
