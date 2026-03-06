const CONTACT_REPOSITORY_TOKEN = "docs.examples.03.contacts.repository";

class ContactRepositoryStage4 {
  findById(_id) {
    throw new Error("ContactRepositoryStage4.findById must be implemented.");
  }

  findByEmail(_email) {
    throw new Error("ContactRepositoryStage4.findByEmail must be implemented.");
  }

  save(_contact) {
    throw new Error("ContactRepositoryStage4.save must be implemented.");
  }

  list() {
    throw new Error("ContactRepositoryStage4.list must be implemented.");
  }
}

export { CONTACT_REPOSITORY_TOKEN, ContactRepositoryStage4 };
