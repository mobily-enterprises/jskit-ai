import { checkDatabase } from "./repository.js";

const repository = Object.freeze({
  checkDatabase
});

function createRepository() {
  return repository;
}

export { createService } from "./service.js";
export { createRepository };
