import { db } from "../../../db/knex.js";

function createRepository(dbClient) {
  async function repoCheckDatabase() {
    await dbClient.raw("select 1 as ok");
    return true;
  }

  return {
    checkDatabase: repoCheckDatabase
  };
}

const repository = createRepository(db);

const __testables = {
  createRepository
};

export const { checkDatabase } = repository;
export { __testables };
