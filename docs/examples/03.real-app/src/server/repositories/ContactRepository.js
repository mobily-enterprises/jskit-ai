const CONTACT_REPOSITORY_TOKEN = "docs.examples.03.contacts.repository";

class ContactRepository {
  findById(_id) {
    throw new Error("ContactRepository.findById must be implemented.");
  }

  findByEmail(_email) {
    throw new Error("ContactRepository.findByEmail must be implemented.");
  }

  save(_contact) {
    throw new Error("ContactRepository.save must be implemented.");
  }

  list() {
    throw new Error("ContactRepository.list must be implemented.");
  }
}

export { CONTACT_REPOSITORY_TOKEN, ContactRepository };
