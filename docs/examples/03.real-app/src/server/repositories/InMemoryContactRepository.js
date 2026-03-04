import { ContactRepository } from "./ContactRepository.js";

class InMemoryContactRepository extends ContactRepository {
  constructor() {
    super();
    this.byId = new Map();
    this.byEmail = new Map();
  }

  findByEmail(email) {
    const id = this.byEmail.get(email) || null;
    if (!id) {
      return null;
    }
    return this.byId.get(id) || null;
  }

  save(contact) {
    this.byId.set(contact.id, contact);
    this.byEmail.set(contact.email, contact.id);
    return contact;
  }

  list() {
    return [...this.byId.values()];
  }
}

export { InMemoryContactRepository };
