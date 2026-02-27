import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/chat-core/repositories/reactions";

const repository = createRepository(db);

export const { addReaction, removeReaction, listByMessageIds, countByMessageId, transaction } = repository;

export { __testables };
