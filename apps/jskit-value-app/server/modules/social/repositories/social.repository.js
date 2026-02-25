import { db } from "../../../../db/knex.js";
import { createRepository as createSocialKnexRepository, socialRepositoryTestables } from "@jskit-ai/social-knex-mysql";

const repository = createSocialKnexRepository(db);

const __testables = {
  ...socialRepositoryTestables
};

export { repository, __testables };
