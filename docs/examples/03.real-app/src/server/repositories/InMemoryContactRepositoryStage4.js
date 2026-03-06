import { ContactRepositoryStage4 } from "./ContactRepositoryStage4.js";

class InMemoryContactRepositoryStage4 extends ContactRepositoryStage4 {
  constructor() {
    super();
    this.byId = new Map();
    this.byEmail = new Map();
  }

  findById(id) {
    return this.byId.get(id) || null;
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

export { InMemoryContactRepositoryStage4 };
