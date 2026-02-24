import { checkDatabase, __testables as healthRepositoryTestables } from "./repository.js";

const healthRepository = Object.freeze({
  checkDatabase
});

export { createService, __testables as healthServiceTestables } from "./service.js";
export { checkDatabase, healthRepository, healthRepositoryTestables };
