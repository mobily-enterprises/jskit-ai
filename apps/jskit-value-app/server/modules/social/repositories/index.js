import * as socialRepositoryModule from "./social.repository.js";

const repository = { ...socialRepositoryModule };
delete repository.__testables;

function createRepository() {
  return {
    repository
  };
}

export { createRepository };
